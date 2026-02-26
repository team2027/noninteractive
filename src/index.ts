#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { socketPath, ensureSessionsDir } from "./paths";
import { sendMessage } from "./client";

const HELP = `usage: noninteractive <command> [args]

  start <name> [args...]   start a session (runs npx <name>)
  read  <name>             read terminal output
  send  <name> <text>      send keystrokes to session
  stop  <name>             stop a session
  list                     show active sessions`;

function getSelfCommand(): string[] {
  if (process.argv[1] && /\.(ts|js)$/.test(process.argv[1])) {
    return [process.argv[0], process.argv[1]];
  }
  return [process.argv[0]];
}

async function start(name: string, args: string[]) {
  const sock = socketPath(name);

  try {
    const res = await sendMessage(sock, { action: "read" });
    if (res.ok) {
      process.stdout.write(res.output ?? "");
      console.log(`\n[session '${name}' already running]`);
      return;
    }
  } catch {}

  ensureSessionsDir();
  try { const { unlinkSync } = await import("node:fs"); unlinkSync(sock); } catch {}

  const self = getSelfCommand();
  const child = spawn(self[0], [...self.slice(1), "__daemon__", name, "npx", name, ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // wait for socket to appear
  for (let i = 0; i < 50; i++) {
    if (existsSync(sock)) break;
    await new Promise(r => setTimeout(r, 100));
  }

  if (!existsSync(sock)) {
    console.error("timeout: failed to start session");
    process.exit(1);
  }

  // poll until we get meaningful output (up to 10s)
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, "");
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await sendMessage(sock, { action: "read" });
      const clean = stripAnsi(res.output ?? "").trim();
      if (clean.length > 10) {
        process.stdout.write(res.output);
        console.log(`\n[session '${name}' started]`);
        return;
      }
      if (res.exited) {
        process.stdout.write(res.output ?? "");
        console.log(`\n[session '${name}' exited ${res.exitCode}]`);
        return;
      }
    } catch {}
  }

  console.log(`[session '${name}' started]`);

  console.error("timeout: failed to start session");
  process.exit(1);
}

async function read(name: string) {
  const sock = socketPath(name);
  const res = await sendMessage(sock, { action: "read" });
  if (res.output !== undefined) process.stdout.write(res.output);
  if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
}

async function send(name: string, text: string) {
  const sock = socketPath(name);
  await sendMessage(sock, { action: "send", data: text });
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
  const sessions = files.filter(f => f.endsWith(".sock")).map(f => f.replace(".sock", ""));

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
      const name = args[1];
      if (!name) { console.error("usage: noninteractive start <name> [args...]"); process.exit(1); }
      return start(name, args.slice(2));
    }
    case "read": {
      const name = args[1];
      if (!name) { console.error("usage: noninteractive read <name>"); process.exit(1); }
      return read(name);
    }
    case "send": {
      const name = args[1];
      const text = args[2];
      if (!name || text === undefined) { console.error("usage: noninteractive send <name> <text>"); process.exit(1); }
      return send(name, text);
    }
    case "stop": {
      const name = args[1];
      if (!name) { console.error("usage: noninteractive stop <name>"); process.exit(1); }
      return stop(name);
    }
    case "list":
    case "ls":
      return list();
    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
