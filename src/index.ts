#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { socketPath, ensureSessionsDir } from "./paths";
import { sendMessage } from "./client";

function getSelfCommand(): string[] {
  if (process.argv[1] && /\.(ts|js)$/.test(process.argv[1])) {
    return [process.argv[0], process.argv[1]];
  }
  return [process.argv[0]];
}

function parseArgs() {
  const args = process.argv.slice(2);

  if (args[0] === "__daemon__") {
    // __daemon__ <session-name> <executable> [args...]
    return { mode: "daemon" as const, sessionName: args[1], executable: args[2], commandArgs: args.slice(3) };
  }

  if (args.length === 0 || args[0] === "--help") {
    return { mode: "help" as const };
  }

  if (args[0] === "--list") {
    return { mode: "list" as const };
  }

  const command = args[0];
  const rest = args.slice(1);

  let action: "start" | "input" | "read" | "kill" = "start";
  let input: string | undefined;
  const commandArgs: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--input" && i + 1 < rest.length) {
      action = "input";
      input = rest[i + 1];
      i++;
    } else if (rest[i] === "--read") {
      action = "read";
    } else if (rest[i] === "--kill") {
      action = "kill";
    } else {
      commandArgs.push(rest[i]);
    }
  }

  return { mode: action, command, commandArgs, input };
}

async function start(command: string, commandArgs: string[]) {
  const sock = socketPath(command);

  try {
    const res = await sendMessage(sock, { action: "read" });
    if (res.ok) {
      process.stdout.write(res.output ?? "");
      console.log(`\n[session '${command}' already running]`);
      return;
    }
  } catch {}

  ensureSessionsDir();
  try { const { unlinkSync } = await import("node:fs"); unlinkSync(sock); } catch {}

  const self = getSelfCommand();
  const child = spawn(self[0], [...self.slice(1), "__daemon__", command, "npx", command, ...commandArgs], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    if (existsSync(sock)) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await sendMessage(sock, { action: "read" });
        if (res.output) process.stdout.write(res.output);
      } catch {}
      console.log(`[session '${command}' started]`);
      return;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  console.error("timeout: failed to start session");
  process.exit(1);
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
  const parsed = parseArgs();

  if (parsed.mode === "daemon") {
    const { runDaemon } = await import("./daemon");
    return runDaemon(parsed.sessionName!, parsed.executable!, parsed.commandArgs!);
  }

  if (parsed.mode === "help") {
    console.log(`usage: 2027 <command> [args...] [--input <text>] [--read] [--kill]
       2027 --list`);
    return;
  }

  if (parsed.mode === "list") {
    return list();
  }

  const { command, commandArgs = [], input } = parsed as any;
  const sock = socketPath(command);

  switch (parsed.mode) {
    case "start":
      return start(command, commandArgs);

    case "input":
      await sendMessage(sock, { action: "input", data: input });
      break;

    case "read": {
      const res = await sendMessage(sock, { action: "read" });
      if (res.output !== undefined) process.stdout.write(res.output);
      if (res.exited) console.log(`\n[exited ${res.exitCode}]`);
      break;
    }

    case "kill":
      await sendMessage(sock, { action: "kill" });
      console.log(`session '${command}' killed`);
      break;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
