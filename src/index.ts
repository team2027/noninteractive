#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { socketPath, ensureSessionsDir } from "./paths";
import { sendMessage } from "./client";

const HELP = `usage: noninteractive <command> [args]

commands:
  start <cmd> [args...]   start a session running <cmd>
  read  <session>          read terminal output
  send  <session> <text>   send keystrokes (empty string for Enter)
  stop  <session>          stop a session
  list                     show active sessions

examples:
  npx noninteractive start npx vercel
  npx noninteractive start vercel login
  npx noninteractive read vercel
  npx noninteractive send vercel ""
  npx noninteractive send vercel "y"
  npx noninteractive stop vercel

session name is derived from the command automatically.
use read/send/stop with that name to interact with the session.`;

function getSelfCommand(): string[] {
  if (process.argv[1] && /\.(ts|js)$/.test(process.argv[1])) {
    return [process.argv[0], process.argv[1]];
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
      console.log(`\n[session '${name}' already running]`);
      return;
    }
  } catch {}

  ensureSessionsDir();
  try { const { unlinkSync } = await import("node:fs"); unlinkSync(sock); } catch {}

  const self = getSelfCommand();
  const child = spawn(self[0], [...self.slice(1), "__daemon__", name, executable, ...args], {
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
      if (args.length < 2) { console.error("usage: noninteractive start <cmd> [args...]\n\nexample: npx noninteractive start npx vercel"); process.exit(1); }
      return start(args.slice(1));
    }
    case "read": {
      const name = args[1];
      if (!name) { console.error("usage: noninteractive read <session>\n\nexample: npx noninteractive read vercel"); process.exit(1); }
      return read(name);
    }
    case "send": {
      const name = args[1];
      const text = args[2];
      if (!name || text === undefined) { console.error("usage: noninteractive send <session> <text>\n\nexample: npx noninteractive send vercel \"y\""); process.exit(1); }
      return send(name, text);
    }
    case "stop": {
      const name = args[1];
      if (!name) { console.error("usage: noninteractive stop <session>\n\nexample: npx noninteractive stop vercel"); process.exit(1); }
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
