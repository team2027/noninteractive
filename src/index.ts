#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { sendMessage } from "./client";
import { ensureSessionsDir, socketPath } from "./paths";

const HELP = `noninteractive — run interactive CLI commands non-interactively.

usage: npx noninteractive <tool> [args...]

commands:
  <tool> [args...]                       start a session (runs npx <tool> in a PTY)
  send  <session> <text> [--wait]        send keystrokes (--wait waits for new output)
  read  <session> [--wait] [--timeout N] read terminal output (--wait blocks until new output)
  stop  <session>                        stop a session
  list                                   show active sessions
  start <cmd> [args...]                  explicit start (for non-npx commands)

flags:
  --wait, -w         block until new output appears (for send and read)
  --timeout <ms>     max wait time in ms (default: 30000, used with --wait)

the session name is auto-derived from the tool (e.g. "workos" → session "workos").

example workflow (recommended — uses --wait to minimize round-trips):
  npx noninteractive workos                    # starts "npx workos", session = "workos"
  npx noninteractive send workos "" --wait     # press Enter, wait for response
  npx noninteractive send workos "y" --wait    # type "y", wait for response
  npx noninteractive read workos --wait        # wait for new output (e.g. OAuth callback)
  npx noninteractive stop workos               # done, stop the session

more examples:
  npx noninteractive vercel                 # session "vercel"
  npx noninteractive supabase init          # session "supabase"
  npx noninteractive start vercel login     # explicit start for non-npx commands`;

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
	// skip npx/bunx prefix to get the real command name
	let i = 0;
	if (parts[i] === "npx" || parts[i] === "bunx") i++;
	// skip flags like -y, --yes
	while (i < parts.length && parts[i].startsWith("-")) i++;
	const name = parts[i] || cmd;
	// strip npm scope @foo/bar -> bar
	return name.replace(/^@[^/]+\//, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

async function start(cmdArgs: string[]) {
	const executable = cmdArgs[0];
	const args = cmdArgs.slice(1);
	const name = deriveSessionName(executable, args);
	const sock = socketPath(name);

	try {
		const res = await sendMessage(sock, { action: "read" });
		if (res.ok) {
			process.stdout.write(res.output ?? "");
			if (res.exited) {
				console.log(
					`\n[session '${name}' already exists but exited ${res.exitCode} — stopping it]`,
				);
				try {
					await sendMessage(sock, { action: "stop" });
				} catch {}
				// fall through to start a new session
			} else {
				console.log(
					`\n[session '${name}' already running — read the output above, then use:]`,
				);
				console.log(
					`  npx noninteractive send ${name} "<text>" --wait  # send and wait for response`,
				);
				console.log(
					`  npx noninteractive read ${name} --wait        # wait for new output`,
				);
				console.log(
					`  npx noninteractive stop ${name}               # stop the session`,
				);
				return;
			}
		}
	} catch {}

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

	// poll until we get meaningful output (up to 10s)
	const stripAnsi = (s: string) =>
		s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, "");
	for (let i = 0; i < 50; i++) {
		await new Promise((r) => setTimeout(r, 200));
		try {
			const res = await sendMessage(sock, { action: "read" });
			const clean = stripAnsi(res.output ?? "").trim();
			if (clean.length > 10) {
				process.stdout.write(res.output);
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
						`  npx noninteractive send ${name} "<text>" --wait  # send and wait for response`,
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
				process.stdout.write(res.output ?? "");
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
		`  npx noninteractive send ${name} "<text>" --wait  # send and wait for response`,
	);
	console.log(
		`  npx noninteractive read ${name} --wait        # wait for new output`,
	);
	console.log(
		`  npx noninteractive stop ${name}               # stop the session`,
	);
}

async function read(name: string, wait: boolean, timeout: number) {
	const sock = socketPath(name);
	const msg: Record<string, unknown> = { action: "read" };
	if (wait) {
		msg.wait = true;
		msg.timeout = timeout;
	}
	const clientTimeout = wait ? timeout + 5000 : 5000;
	const res = await sendMessage(sock, msg, clientTimeout);
	if (res.output !== undefined) process.stdout.write(res.output);
	if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
}

async function send(
	name: string,
	text: string,
	wait: boolean,
	timeout: number,
) {
	const sock = socketPath(name);
	if (wait) {
		const res = await sendMessage(
			sock,
			{ action: "sendread", data: text, timeout },
			timeout + 5000,
		);
		if (res.output !== undefined) process.stdout.write(res.output);
		if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
	} else {
		await sendMessage(sock, { action: "send", data: text });
		console.log(
			`[sent to '${name}' — run "npx noninteractive read ${name}" to see the result]`,
		);
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
			if (args.length < 2) {
				console.error(
					"usage: noninteractive start <cmd> [args...]\n\nexample: npx noninteractive start npx vercel",
				);
				process.exit(1);
			}
			return start(args.slice(1));
		}
		case "read": {
			const readArgs = args.slice(1);
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
			return read(name, wait, timeout);
		}
		case "sendread":
		case "send": {
			const sendArgs = args.slice(1);
			const positional = sendArgs.filter((a) => !a.startsWith("-"));
			const name = positional[0];
			const text = positional[1];
			if (!name || text === undefined) {
				console.error(
					'usage: noninteractive send <session> <text> [--wait] [--timeout <ms>]\n\nexample: npx noninteractive send workos "" --wait',
				);
				process.exit(1);
			}
			const wait =
				cmd === "sendread" ||
				sendArgs.includes("-w") ||
				sendArgs.includes("--wait");
			const timeoutIdx = sendArgs.indexOf("--timeout");
			const timeout =
				timeoutIdx !== -1 ? Number(sendArgs[timeoutIdx + 1]) : 30000;
			return send(name, text, wait, timeout);
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
		default:
			// treat unknown commands as: start npx --yes <args>
			// --yes auto-accepts package installs so the session doesn't hang on a prompt
			console.log(`[installing and running: npx ${args.join(" ")}]`);
			return start(["npx", "--yes", ...args]);
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
