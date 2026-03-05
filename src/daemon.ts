import { spawn } from "node:child_process";
import { unlinkSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { ensureSessionsDir, socketPath } from "./paths";

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

	const candidates = [
		resolve(dirname(process.argv[1] || process.execPath), "native", binaryName),
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

	let outputBuffer = "";
	let processExited = false;
	let exitCode: number | null = null;

	type Waiter = { resolve: (output: string) => void; timer: ReturnType<typeof setTimeout> };
	const waiters: Waiter[] = [];

	function notifyWaiters() {
		while (waiters.length > 0) {
			const w = waiters.shift()!;
			clearTimeout(w.timer);
			w.resolve(outputBuffer);
		}
	}

	const ptyBridge = getPtyBridge();
	const proc = spawn(ptyBridge, [executable, ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, TERM: "xterm-256color" },
	});

	const { stdout, stderr, stdin } = proc;

	stdout?.on("data", (chunk: Buffer) => {
		outputBuffer += chunk.toString();
		notifyWaiters();
	});

	stderr?.on("data", (chunk: Buffer) => {
		outputBuffer += chunk.toString();
		notifyWaiters();
	});

	proc.on("exit", (code) => {
		processExited = true;
		exitCode = code;
		outputBuffer += `\n[exited ${code}]`;
		notifyWaiters();

		setTimeout(() => {
			server.close();
			try {
				unlinkSync(sock);
			} catch {}
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
		socket.end(
			JSON.stringify({
				ok: true,
				output: outputBuffer,
				exited: processExited,
				exitCode,
			}),
		);
	}

	function waitForNewOutput(socket: Socket, sinceLength: number, timeout: number) {
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
				stdin?.write(`${msg.data}\r`);
				socket.end(JSON.stringify({ ok: true }));
				break;

			case "sendread": {
				if (processExited) {
					socket.end(JSON.stringify({ ok: false, error: "process exited" }));
					break;
				}
				const beforeLength = outputBuffer.length;
				const timeout = msg.timeout ?? 30000;
				stdin?.write(`${msg.data}\r`);
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
