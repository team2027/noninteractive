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
	sessionUrlsFile,
	socketPath,
} from "./paths";

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

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

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
	const detectedUrls = new Set<string>();
	const reportedUrls = new Set<string>();

	type Waiter = {
		resolve: (output: string) => void;
		timer: ReturnType<typeof setTimeout>;
	};
	const waiters: Waiter[] = [];

	let notifyDebounce: ReturnType<typeof setTimeout> | null = null;
	const NOTIFY_SETTLE_MS = 50;

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
	const proc = spawn(ptyBridge, [executable, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			TERM: "xterm-256color",
			BROWSER: resolve(binDir, "browser-open"),
			PATH: `${binDir}:${process.env.PATH}`,
		},
	});

	const { stdout, stderr, stdin } = proc;

	function scanForUrls(text: string) {
		const matches = text.match(URL_RE);
		if (matches) {
			for (const url of matches) detectedUrls.add(url);
		}
	}

	function readInterceptedUrls() {
		const urlsFile = sessionUrlsFile(sessionName);
		try {
			if (!existsSync(urlsFile)) return;
			const content = readFileSync(urlsFile, "utf-8");
			const lines = content.split("\n");
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed) detectedUrls.add(trimmed);
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

	function respondWithOutput(socket: Socket) {
		readInterceptedUrls();
		const newUrls = Array.from(detectedUrls).filter(
			(u) => !reportedUrls.has(u),
		);
		for (const u of newUrls) reportedUrls.add(u);
		socket.end(
			JSON.stringify({
				ok: true,
				output: outputBuffer,
				exited: processExited,
				exitCode,
				...(newUrls.length > 0 ? { urls: newUrls } : {}),
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

	function handle(msg: DaemonMessage, socket: Socket) {
		switch (msg.action) {
			case "read":
				if (msg.wait) {
					const timeout = msg.timeout ?? 30000;
					waitForNewOutput(socket, outputBuffer.length, timeout);
				} else {
					respondWithOutput(socket);
				}
				break;

			case "send":
				if (processExited) {
					socket.end(JSON.stringify({ ok: false, error: "process exited" }));
					break;
				}
				stdin?.write(msg.data);
				socket.end(JSON.stringify({ ok: true }));
				break;

			case "sendread": {
				if (processExited) {
					socket.end(JSON.stringify({ ok: false, error: "process exited" }));
					break;
				}
				const beforeLength = outputBuffer.length;
				const timeout = msg.timeout ?? 30000;
				stdin?.write(msg.data);
				waitForNewOutput(socket, beforeLength, timeout);
				break;
			}

			case "stop":
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
