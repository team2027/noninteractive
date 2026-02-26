import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { unlinkSync } from "node:fs";
import { socketPath, ensureSessionsDir } from "./paths";

export function runDaemon(sessionName: string, executable: string, args: string[]) {
  ensureSessionsDir();
  const sock = socketPath(sessionName);

  try { unlinkSync(sock); } catch {}

  let outputBuffer = "";
  let processExited = false;
  let exitCode: number | null = null;

  const proc = spawn(executable, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  proc.stdout!.on("data", (chunk: Buffer) => {
    outputBuffer += chunk.toString();
  });

  proc.stderr!.on("data", (chunk: Buffer) => {
    outputBuffer += chunk.toString();
  });

  proc.on("exit", (code) => {
    processExited = true;
    exitCode = code;
    outputBuffer += `\n[exited ${code}]`;

    setTimeout(() => {
      server.close();
      try { unlinkSync(sock); } catch {}
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

  function handle(msg: any, socket: any) {
    switch (msg.action) {
      case "read":
        socket.end(JSON.stringify({
          ok: true,
          output: outputBuffer,
          exited: processExited,
          exitCode,
        }));
        break;

      case "input":
        if (processExited) {
          socket.end(JSON.stringify({ ok: false, error: "process exited" }));
          break;
        }
        proc.stdin!.write(msg.data + "\n");
        socket.end(JSON.stringify({ ok: true }));
        break;

      case "kill":
        proc.kill("SIGTERM");
        socket.end(JSON.stringify({ ok: true }));
        setTimeout(() => {
          server.close();
          try { unlinkSync(sock); } catch {}
          process.exit(0);
        }, 500);
        break;

      case "status":
        socket.end(JSON.stringify({
          ok: true,
          running: !processExited,
          pid: proc.pid,
          exitCode,
        }));
        break;

      default:
        socket.end(JSON.stringify({ ok: false, error: "unknown action" }));
    }
  }

  server.listen(sock);
}
