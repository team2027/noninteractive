#!/usr/bin/env bun

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { type DaemonResponse, sendMessage } from "./client";
import { ensureSessionsDir, sessionOutputFile, socketPath } from "./paths";

const HELP = `noninteractive — run interactive CLI commands non-interactively.

usage: npx noninteractive <tool> [args...]

commands:
  <tool> [args...]                       start a session (runs npx <tool> in a PTY)
  send  <session> <text> [--no-wait]     send keystrokes and return output (--no-wait to fire-and-forget)
  read  <session> [--wait] [--timeout N] read terminal output (--wait blocks until new output)
  stop  <session>                        stop a session
  list                                   show active sessions
  start [--name N] [--cwd D] <cmd> [args...]  explicit start (for non-npx commands)

flags:
  --name <session>   set session name (default: auto-derived from tool name)
  --cwd <dir>        set working directory for the command
  --no-wait          fire-and-forget mode for send (don't wait for output)
  --wait, -w         block until new output appears (for read)
  --timeout <ms>     max wait time in ms (default: 30000)
  --no-open          don't auto-open URLs in browser (still shown in output)

the session name is auto-derived from the tool (e.g. "workos" → session "workos").
use --name to override, --cwd to set the working directory.

text is sent raw — no auto-appended enter. escape sequences are parsed:
  \\r = Enter, \\n = newline, \\t = tab, \\x1b = escape (for arrow keys)

example workflow:
  npx noninteractive workos                            # starts "npx workos", session = "workos"
  npx noninteractive send workos ""                    # press Enter (empty string = Enter)
  npx noninteractive send workos "y\\r"                 # type "y" + Enter
  npx noninteractive send workos "\\x1b[B\\r"           # arrow down + Enter
  npx noninteractive send workos "\\x1b[B"             # arrow down (no Enter)
  npx noninteractive read workos --wait                # wait for new output (e.g. OAuth callback)
  npx noninteractive stop workos                       # done, stop the session

more examples:
  npx noninteractive vercel                 # session "vercel"
  npx noninteractive supabase init          # session "supabase"
  npx noninteractive start vercel login     # explicit start for non-npx commands`;

function stripAnsi(s: string): string {
	// step 0: screen-clear — only keep content after the last clear screen
	const lastClear = Math.max(
		s.lastIndexOf("\x1b[2J"),
		s.lastIndexOf("\x1b[H\x1b[2J"),
	);
	if (lastClear !== -1) s = s.slice(lastClear);

	// step 1: erase-line → newline
	s = s.replace(/\x1b\[[012]?K/g, "\n");

	// step 2: convert bold/underline/inverse to **...** markers
	// stateful pass: track open spans, emit markers on close
	let result = "";
	let bold = false;
	let boldBuf = "";
	let i = 0;
	while (i < s.length) {
		// match any SGR sequence: \x1b[ ... m
		if (s[i] === "\x1b" && s[i + 1] === "[") {
			const end = s.indexOf("m", i + 2);
			if (end !== -1 && end - i < 16 && /^[\d;]*$/.test(s.slice(i + 2, end))) {
				const codes = s.slice(i + 2, end).split(";").map(Number);
				for (const code of codes) {
					if (code === 1 || code === 4 || code === 7) {
						// bold, underline, or inverse ON
						if (!bold) {
							bold = true;
							boldBuf = "";
						}
					} else if (code === 0 || code === 22 || code === 24 || code === 27) {
						// reset / bold off / underline off / inverse off
						if (bold && boldBuf.trim()) {
							result += `**${boldBuf}**`;
						} else if (bold) {
							result += boldBuf;
						}
						bold = false;
						boldBuf = "";
					}
				}
				i = end + 1;
				continue;
			}
		}
		// match any other escape sequence (non-SGR) — strip it
		if (s[i] === "\x1b") {
			if (s[i + 1] === "[") {
				const end = s.slice(i + 2).search(/[\x40-\x7e]/);
				if (end !== -1) { i += end + 3; continue; }
			} else if (s[i + 1] === "]") {
				const end = s.indexOf("\x07", i);
				if (end !== -1) { i = end + 1; continue; }
				const end2 = s.indexOf("\x1b\\", i);
				if (end2 !== -1) { i = end2 + 2; continue; }
			} else if (s[i + 1] === "(" || s[i + 1] === ")") {
				i += 3; continue;
			} else {
				i += 2; continue;
			}
		}
		if (s[i] === "\x07") { i++; continue; }
		if (bold) {
			boldBuf += s[i];
		} else {
			result += s[i];
		}
		i++;
	}
	// flush any remaining bold buffer
	if (bold && boldBuf.trim()) {
		result += `**${boldBuf}**`;
	} else if (bold) {
		result += boldBuf;
	}

	return result
		.replace(/\r\n?/g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

const seenUrls = new Set<string>();

function openUrl(url: string) {
	try {
		const cmd = process.platform === "darwin" ? "open" : "xdg-open";
		execSync(`${cmd} ${JSON.stringify(url)}`, { stdio: "ignore" });
	} catch {}
}

function handleUrls(res: DaemonResponse, noOpen: boolean) {
	if (!res.urls || res.urls.length === 0) return;
	for (const url of res.urls) {
		if (seenUrls.has(url)) continue;
		seenUrls.add(url);
		if (!noOpen) {
			openUrl(url);
			process.stderr.write(`[opened: ${url}]\n`);
		} else {
			process.stderr.write(`[url: ${url}]\n`);
		}
	}
}

function getSelfCommand(): string[] {
	const script = process.argv[1];
	if (!script) return [process.argv[0]];

	// resolve symlinks (npx creates .bin/noninteractive -> ../noninteractive/bin/noninteractive.js)
	const { realpathSync } = require("node:fs");
	try {
		const real = realpathSync(script);
		if (/\.(ts|js)$/.test(real)) {
			return [process.argv[0], real];
		}
	} catch {}

	if (/\.(ts|js)$/.test(script)) {
		return [process.argv[0], script];
	}
	return [process.argv[0]];
}

function deriveSessionName(cmd: string, args: string[]): string {
	const parts = [cmd, ...args];
	let i = 0;
	// skip npx/bunx, flags, and -- separators to find the real tool name
	while (i < parts.length) {
		if (parts[i] === "npx" || parts[i] === "bunx") {
			i++;
			continue;
		}
		if (parts[i] === "--") {
			i++;
			continue;
		}
		if (parts[i].startsWith("-")) {
			i++;
			continue;
		}
		break;
	}
	const name = parts[i] || cmd;
	// strip version suffix @latest, @1.2.3, @^5 etc (but not scope prefix @foo/)
	const stripped = name.replace(/(?<=.)@[^/].*$/, "");
	// strip npm scope @foo/bar -> bar
	return (stripped || name)
		.replace(/^@[^/]+\//, "")
		.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function start(
	cmdArgs: string[],
	noOpen = false,
	sessionName?: string,
	cwd?: string,
) {
	const executable = cmdArgs[0];
	const args = cmdArgs.slice(1);
	const baseName = sessionName || deriveSessionName(executable, args);
	let name = baseName;

	// auto-suffix if session name is already taken by a live session
	let suffix = 1;
	while (true) {
		const sock = socketPath(name);
		try {
			const res = await sendMessage(sock, { action: "read" });
			if (res.ok) {
				if (res.exited) {
					// exited session — stop it and reuse the name
					try {
						await sendMessage(sock, { action: "stop" });
					} catch {}
					break;
				}
				// live session — try next suffix
				suffix++;
				name = `${baseName}-${suffix}`;
				continue;
			}
		} catch {}
		break;
	}
	const sock = socketPath(name);

	ensureSessionsDir();
	try {
		const { unlinkSync } = await import("node:fs");
		unlinkSync(sock);
	} catch {}

	const self = getSelfCommand();
	const child = spawn(
		self[0],
		[...self.slice(1), "__daemon__", name, executable, ...args],
		{
			detached: true,
			stdio: "ignore",
			...(cwd ? { env: { ...process.env, NI_CWD: cwd } } : {}),
		},
	);
	child.unref();

	// wait for socket to appear
	for (let i = 0; i < 50; i++) {
		if (existsSync(sock)) break;
		await new Promise((r) => setTimeout(r, 100));
	}

	if (!existsSync(sock)) {
		console.error(`error: failed to start session '${name}'.`);
		console.error(`the command was: ${executable} ${args.join(" ")}`);
		console.error(`\nmake sure the command exists. examples:`);
		console.error(
			`  npx noninteractive start npx vercel        # run an npx package`,
		);
		console.error(
			`  npx noninteractive start vercel login       # run a command directly`,
		);
		process.exit(1);
	}

	// poll until we get meaningful output (up to 30s)
	// spinner chars (braille dots) don't count — wait for real content
	const stripSpinners = (s: string) =>
		s.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠛⠳⠞⠽⠻⠿⠾⠷⠯⠟]/g, "").trim();
	for (let i = 0; i < 150; i++) {
		await new Promise((r) => setTimeout(r, 200));
		try {
			const res = await sendMessage(sock, { action: "read" });
			handleUrls(res, noOpen);
			const clean = stripSpinners(stripAnsi(res.output ?? ""));
			if (clean.length > 10) {
				process.stdout.write(stripAnsi(res.output));
				if (res.exited) {
					console.log(
						`\n[session '${name}' exited ${res.exitCode} — the command failed]`,
					);
					console.log(
						`hint: the first argument to "start" is the command to run, NOT a session name.`,
					);
					console.log(
						`  npx noninteractive start npx vercel        # run an npx package`,
					);
					console.log(
						`  npx noninteractive start vercel login       # run a command directly`,
					);
				} else {
					console.log(
						`\n[session '${name}' started — read the output above, then use:]`,
					);
					console.log(
						`  npx noninteractive send ${name} "<text>"          # send and get response`,
					);
					console.log(
						`  npx noninteractive read ${name} --wait        # wait for new output`,
					);
					console.log(
						`  npx noninteractive stop ${name}               # stop the session`,
					);
				}
				return;
			}
			if (res.exited) {
				process.stdout.write(stripAnsi(res.output ?? ""));
				console.log(
					`\n[session '${name}' exited ${res.exitCode} — the command failed]`,
				);
				console.log(
					`hint: the first argument to "start" is the command to run, NOT a session name.`,
				);
				console.log(
					`  npx noninteractive start npx vercel        # run an npx package`,
				);
				console.log(
					`  npx noninteractive start vercel login       # run a command directly`,
				);
				return;
			}
		} catch {}
	}

	console.log(`[session '${name}' started but no output yet — use:]`);
	console.log(
		`  npx noninteractive send ${name} "<text>"          # send and get response`,
	);
	console.log(
		`  npx noninteractive read ${name} --wait        # wait for new output`,
	);
	console.log(
		`  npx noninteractive stop ${name}               # stop the session`,
	);
}

async function read(
	name: string,
	wait: boolean,
	timeout: number,
	noOpen = false,
) {
	const sock = socketPath(name);
	const msg: Record<string, unknown> = { action: "read" };
	if (wait) {
		msg.wait = true;
		msg.timeout = timeout;
	}
	const clientTimeout = wait ? timeout + 5000 : 5000;
	try {
		const res = await sendMessage(sock, msg, clientTimeout);
		if (res.output !== undefined) process.stdout.write(stripAnsi(res.output));
		handleUrls(res, noOpen);
		if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
	} catch {
		// daemon gone — try persisted output file
		const outputFile = sessionOutputFile(name);
		if (existsSync(outputFile)) {
			const output = readFileSync(outputFile, "utf-8");
			process.stdout.write(stripAnsi(output));
			console.log(`\n[session exited]`);
		} else {
			console.error(`session '${name}' not found`);
			process.exit(1);
		}
	}
}

async function send(
	name: string,
	text: string,
	wait: boolean,
	timeout: number,
	noOpen = false,
) {
	// empty string "" is a shorthand for pressing Enter
	if (text === "") text = "\r";
	// parse C-style escape sequences so agents don't need shell $'...' quoting
	text = text.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/\\r/g, "\r")
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t");
	const sock = socketPath(name);
	try {
		if (wait) {
			const res = await sendMessage(
				sock,
				{ action: "sendread", data: text, timeout },
				timeout + 5000,
			);
			if (res.output !== undefined) process.stdout.write(stripAnsi(res.output));
			handleUrls(res, noOpen);
			if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
		} else {
			await sendMessage(sock, { action: "send", data: text });
			console.log(
				`[sent to '${name}' — run "npx noninteractive read ${name}" to see the result]`,
			);
		}
	} catch {
		// daemon gone — try persisted output file
		const outputFile = sessionOutputFile(name);
		if (existsSync(outputFile)) {
			const output = readFileSync(outputFile, "utf-8");
			process.stdout.write(stripAnsi(output));
			console.log(`\n[session exited]`);
		} else {
			console.error(`session '${name}' not found`);
			process.exit(1);
		}
	}
}

async function stop(name: string) {
	const sock = socketPath(name);
	await sendMessage(sock, { action: "stop" });
	console.log(`session '${name}' stopped`);
}

async function list() {
	const { readdirSync } = await import("node:fs");
	ensureSessionsDir();
	const files = readdirSync((await import("./paths")).SESSIONS_DIR);
	const sessions = files
		.filter((f) => f.endsWith(".sock"))
		.map((f) => f.replace(".sock", ""));

	if (sessions.length === 0) {
		console.log("no active sessions");
		return;
	}

	for (const name of sessions) {
		const sock = socketPath(name);
		try {
			const res = await sendMessage(sock, { action: "status" });
			const status = res.running ? "running" : `exited (${res.exitCode})`;
			console.log(`${name} [${status}] pid=${res.pid}`);
		} catch {
			console.log(`${name} [dead]`);
		}
	}
}

async function main() {
	const args = process.argv.slice(2);

	if (args[0] === "__daemon__") {
		const { runDaemon } = await import("./daemon");
		return runDaemon(args[1], args[2], args.slice(3));
	}

	const cmd = args[0];

	switch (cmd) {
		case "start": {
			const startArgs = args.slice(1);
			const noOpen = startArgs.includes("--no-open");
			// parse --name and --cwd flags
			let sessionName: string | undefined;
			let cwd: string | undefined;
			const nameIdx = startArgs.indexOf("--name");
			if (nameIdx !== -1) {
				sessionName = startArgs[nameIdx + 1];
				startArgs.splice(nameIdx, 2);
			}
			const cwdIdx = startArgs.indexOf("--cwd");
			if (cwdIdx !== -1) {
				cwd = startArgs[cwdIdx + 1];
				startArgs.splice(cwdIdx, 2);
			}
			const filtered = startArgs.filter(
				(a) => a !== "--no-open",
			);
			if (filtered.length < 1) {
				console.error(
					"usage: noninteractive start [--name <session>] [--cwd <dir>] <cmd> [args...]\n\nexamples:\n  npx noninteractive start npx eslint --init\n  npx noninteractive start --name myeslint --cwd /tmp/project npx eslint --init",
				);
				process.exit(1);
			}
			return start(filtered, noOpen, sessionName, cwd);
		}
		case "read": {
			const readArgs = args.slice(1);
			const noOpen = readArgs.includes("--no-open");
			const name = readArgs.find((a) => !a.startsWith("-"));
			if (!name) {
				console.error(
					"usage: noninteractive read <session> [-w|--wait] [--timeout <ms>]\n\nexample: npx noninteractive read vercel --wait",
				);
				process.exit(1);
			}
			const wait = readArgs.includes("-w") || readArgs.includes("--wait");
			const timeoutIdx = readArgs.indexOf("--timeout");
			const timeout =
				timeoutIdx !== -1 ? Number(readArgs[timeoutIdx + 1]) : 30000;
			return read(name, wait, timeout, noOpen);
		}
		case "sendread":
		case "send": {
			const sendArgs = args.slice(1);
			const noOpen = sendArgs.includes("--no-open");
			const positional = sendArgs.filter((a) => !a.startsWith("-"));
			const name = positional[0];
			const text = positional[1];
			if (!name || text === undefined) {
				console.error(
					'usage: noninteractive send <session> <text> [--no-wait] [--timeout <ms>]\n\nexample: npx noninteractive send workos ""',
				);
				process.exit(1);
			}
			// send waits by default; --no-wait disables waiting
			const noWait =
				sendArgs.includes("--no-wait") || sendArgs.includes("--silent");
			const wait =
				!noWait ||
				cmd === "sendread" ||
				sendArgs.includes("-w") ||
				sendArgs.includes("--wait");
			const timeoutIdx = sendArgs.indexOf("--timeout");
			const timeout =
				timeoutIdx !== -1 ? Number(sendArgs[timeoutIdx + 1]) : 30000;
			return send(name, text, wait, timeout, noOpen);
		}
		case "stop": {
			const name = args[1];
			if (!name) {
				console.error(
					"usage: noninteractive stop <session>\n\nexample: npx noninteractive stop vercel",
				);
				process.exit(1);
			}
			return stop(name);
		}
		case "list":
		case "ls":
			return list();
		case "version":
		case "--version":
		case "-v": {
			const { version } = require("../package.json");
			console.log(`noninteractive v${version}`);
			return;
		}
		case undefined:
		case "help":
		case "--help":
		case "-h":
			console.log(HELP);
			break;
		default: {
			// parse --name and --cwd flags before the tool name
			let sessionName: string | undefined;
			let cwd: string | undefined;
			const mutableArgs = [...args];
			const nameIdx = mutableArgs.indexOf("--name");
			if (nameIdx !== -1) {
				sessionName = mutableArgs[nameIdx + 1];
				mutableArgs.splice(nameIdx, 2);
			}
			const cwdIdx = mutableArgs.indexOf("--cwd");
			if (cwdIdx !== -1) {
				cwd = mutableArgs[cwdIdx + 1];
				mutableArgs.splice(cwdIdx, 2);
			}

			// detect remaining wrong flags before the tool name
			const wrongFlags = ["--dir", "--session"];
			const firstPositional = mutableArgs.findIndex((a) => !a.startsWith("-") && a !== "--");
			const flagsBefore = firstPositional === -1 ? mutableArgs : mutableArgs.slice(0, firstPositional);
			const wrongFlag = flagsBefore.find((a) => wrongFlags.includes(a.split("=")[0]));
			if (wrongFlag) {
				console.error(
					`unknown flag: ${wrongFlag}\n\nhint: use --name for session name, --cwd for working directory.`,
				);
				process.exit(1);
			}

			// treat unknown commands as: start npx --yes <args>
			const noOpen = mutableArgs.includes("--no-open");
			const filteredArgs = mutableArgs.filter((a) => a !== "--no-open");
			console.log(`[installing and running: npx ${filteredArgs.join(" ")}]`);
			return start(["npx", "--yes", ...filteredArgs], noOpen, sessionName, cwd);
		}
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
