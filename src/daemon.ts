import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import {
	ensureSessionsDir,
	sessionBinDir,
	sessionDir,
	sessionOutputFile,
	sessionUrlsFile,
	socketPath,
} from "./paths";
import { extractUrls } from "./urls";

interface DaemonMessage {
	action: "read" | "send" | "sendread" | "stop" | "status";
	data?: string;
	wait?: boolean;
	timeout?: number;
}

function getPtyBridge(): string {
	const platform = process.platform;
	const arch = process.arch;
	const binaryName = `ptybridge-${platform}-${arch}`;

	const scriptDir = dirname(process.argv[1] || process.execPath);
	const candidates = [
		resolve(scriptDir, "..", "native", binaryName),
		resolve(scriptDir, "native", binaryName),
		resolve(dirname(import.meta.dirname), "native", binaryName),
		resolve(import.meta.dirname, "..", "native", binaryName),
	];
	for (const p of candidates) {
		try {
			const { statSync } = require("node:fs");
			if (statSync(p).isFile()) return p;
		} catch {}
	}
	return candidates[0];
}

function createInterceptorScripts(name: string) {
	const binDir = sessionBinDir(name);
	const urlsFile = sessionUrlsFile(name);
	mkdirSync(binDir, { recursive: true });

	// macOS: shadow `open` — only intercept http/https URLs, pass everything else through
	const openScript = `#!/bin/sh
case "$1" in
  http://*|https://*) echo "$1" >> "${urlsFile}" ;;
  *) /usr/bin/open "$@" ;;
esac
`;

	// linux: shadow xdg-open
	const xdgOpenScript = `#!/bin/sh
echo "$1" >> "${urlsFile}"
`;

	// BROWSER env var target
	const browserOpenScript = `#!/bin/sh
echo "$1" >> "${urlsFile}"
`;

	for (const [file, content] of [
		["open", openScript],
		["xdg-open", xdgOpenScript],
		["browser-open", browserOpenScript],
	] as const) {
		const path = resolve(binDir, file);
		writeFileSync(path, content);
		chmodSync(path, 0o755);
	}
}

function cleanupSession(name: string) {
	try {
		rmSync(sessionDir(name), { recursive: true, force: true });
	} catch {}
}

export function runDaemon(
	sessionName: string,
	executable: string,
	args: string[],
) {
	ensureSessionsDir();
	const sock = socketPath(sessionName);

	try {
		unlinkSync(sock);
	} catch {}

	createInterceptorScripts(sessionName);

	let outputBuffer = "";
	let processExited = false;
	let exitCode: number | null = null;
	let lastReadLength = 0; // tracks what the client has seen
	// every url surfaced to the client (output scans + browser-open intercepts),
	// punctuation-trimmed and deduped; the client decides what to do with them
	const detectedUrls = new Set<string>();
	const reportedUrls = new Set<string>();
	// urls the shim actually intercepted (the CLI tried to open them via
	// PATH `open`/`xdg-open`/$BROWSER, which we captured and suppressed). these
	// are the ones the client MUST open itself — a CLI that self-opens natively
	// (railway/supabase) bypasses the shim and never lands here, so the client
	// knows not to double-open it.
	const interceptedUrls = new Set<string>();

	type Waiter = {
		resolve: (output: string) => void;
		timer: ReturnType<typeof setTimeout>;
	};
	const waiters: Waiter[] = [];

	let notifyDebounce: ReturnType<typeof setTimeout> | null = null;
	const NOTIFY_SETTLE_MS = 50;

	// anti-cascade: track last stdin write so rapid chained sends
	// don't land keystrokes before the PTY settles from the previous interaction
	let lastStdinWrite = 0;
	const INPUT_SETTLE_MS = 150;

	function notifyWaiters() {
		if (waiters.length === 0) return;
		// debounce: wait a short time for more output to arrive before resolving
		// this prevents resolving on partial output (e.g. PTY echo before the real response)
		if (notifyDebounce) clearTimeout(notifyDebounce);
		notifyDebounce = setTimeout(() => {
			notifyDebounce = null;
			let w = waiters.shift();
			while (w) {
				clearTimeout(w.timer);
				w.resolve(outputBuffer);
				w = waiters.shift();
			}
		}, NOTIFY_SETTLE_MS);
	}

	const binDir = sessionBinDir(sessionName);
	const ptyBridge = getPtyBridge();
	const spawnCwd = process.env.NI_CWD || process.cwd();
	const proc = spawn(ptyBridge, [executable, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		cwd: spawnCwd,
		env: {
			...process.env,
			TERM: "xterm-256color",
			BROWSER: resolve(binDir, "browser-open"),
			PATH: `${binDir}:${process.env.PATH}`,
		},
	});

	const { stdout, stderr, stdin } = proc;

	function scanForUrls(text: string) {
		for (const url of extractUrls(text)) detectedUrls.add(url);
	}

	function readInterceptedUrls() {
		const urlsFile = sessionUrlsFile(sessionName);
		try {
			if (!existsSync(urlsFile)) return;
			const content = readFileSync(urlsFile, "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				// intercepted urls are the exact argv the child asked to open, not
				// prose — keep them verbatim (a trailing "." etc may be a real
				// query/state value). trimming only applies to scanned output.
				const trimmed = line.trim();
				if (!trimmed) continue;
				detectedUrls.add(trimmed);
				interceptedUrls.add(trimmed);
			}
		} catch {}
	}

	stdout?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		outputBuffer += text;
		scanForUrls(text);
		notifyWaiters();
	});

	stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		outputBuffer += text;
		scanForUrls(text);
		notifyWaiters();
	});

	proc.on("exit", (code) => {
		processExited = true;
		exitCode = code;
		outputBuffer += `\n[exited ${code}]`;
		// persist output so reads work after daemon shuts down
		try {
			writeFileSync(sessionOutputFile(sessionName), outputBuffer);
		} catch {}
		// flush immediately on exit — no need to debounce
		if (notifyDebounce) clearTimeout(notifyDebounce);
		notifyDebounce = null;
		let w = waiters.shift();
		while (w) {
			clearTimeout(w.timer);
			w.resolve(outputBuffer);
			w = waiters.shift();
		}

		setTimeout(() => {
			server.close();
			try {
				unlinkSync(sock);
			} catch {}
			cleanupSession(sessionName);
			process.exit(0);
		}, 60_000);
	});

	proc.on("error", (err) => {
		outputBuffer += `\n[error: ${err.message}]`;
		processExited = true;
	});

	const server = createServer((socket) => {
		let buf = "";

		socket.on("data", (chunk) => {
			buf += chunk.toString();
			try {
				const msg = JSON.parse(buf);
				buf = "";
				handle(msg, socket);
			} catch {}
		});
	});

	function respondWithOutput(socket: Socket, updateSnapshot = true) {
		readInterceptedUrls();
		if (updateSnapshot) lastReadLength = outputBuffer.length;
		const newUrls = Array.from(detectedUrls).filter(
			(u) => !reportedUrls.has(u),
		);
		for (const u of newUrls) reportedUrls.add(u);
		const intercepted = newUrls.filter((u) => interceptedUrls.has(u));
		socket.end(
			JSON.stringify({
				ok: true,
				output: outputBuffer,
				outputLength: outputBuffer.length,
				exited: processExited,
				exitCode,
				...(newUrls.length > 0 ? { urls: newUrls } : {}),
				...(intercepted.length > 0 ? { intercepted } : {}),
			}),
		);
	}

	function waitForNewOutput(
		socket: Socket,
		sinceLength: number,
		timeout: number,
	) {
		if (outputBuffer.length > sinceLength || processExited) {
			respondWithOutput(socket);
			return;
		}

		const waiter: Waiter = {
			resolve: () => respondWithOutput(socket),
			timer: setTimeout(() => {
				const idx = waiters.indexOf(waiter);
				if (idx !== -1) waiters.splice(idx, 1);
				respondWithOutput(socket);
			}, timeout),
		};
		waiters.push(waiter);
	}

	function writeToStdin(data: string | undefined) {
		lastStdinWrite = Date.now();
		stdin?.write(data);
	}

	function withSettleDelay(fn: () => void) {
		const now = Date.now();
		const elapsed = now - lastStdinWrite;
		const delay = Math.max(0, INPUT_SETTLE_MS - elapsed);
		if (delay > 0) {
			setTimeout(fn, delay);
		} else {
			fn();
		}
	}

	function handle(msg: DaemonMessage, socket: Socket) {
		switch (msg.action) {
			case "read":
				if (msg.wait) {
					const timeout = msg.timeout ?? 30000;
					// wait for output beyond what the client last saw
					waitForNewOutput(socket, lastReadLength, timeout);
				} else {
					respondWithOutput(socket);
				}
				break;

			case "send":
				if (processExited) {
					socket.end(JSON.stringify({ ok: false, error: "process exited" }));
					break;
				}
				withSettleDelay(() => {
					writeToStdin(msg.data);
					lastReadLength = outputBuffer.length;
					socket.end(JSON.stringify({ ok: true }));
				});
				break;

			case "sendread": {
				if (processExited) {
					socket.end(JSON.stringify({ ok: false, error: "process exited" }));
					break;
				}
				const beforeLength = outputBuffer.length;
				const timeout = msg.timeout ?? 30000;
				withSettleDelay(() => {
					writeToStdin(msg.data);
					waitForNewOutput(socket, beforeLength, timeout);
				});
				break;
			}

			case "stop":
				// persist output before shutdown
				try {
					writeFileSync(sessionOutputFile(sessionName), outputBuffer);
				} catch {}
				proc.kill("SIGTERM");
				socket.end(JSON.stringify({ ok: true }));
				setTimeout(() => {
					server.close();
					try {
						unlinkSync(sock);
					} catch {}
					cleanupSession(sessionName);
					process.exit(0);
				}, 500);
				break;

			case "status":
				socket.end(
					JSON.stringify({
						ok: true,
						running: !processExited,
						pid: proc.pid,
						exitCode,
					}),
				);
				break;

			default:
				socket.end(JSON.stringify({ ok: false, error: "unknown action" }));
		}
	}

	server.listen(sock);
}
