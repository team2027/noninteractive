# Show HN: Noninteractive – Run interactive CLI flows without a human

I built a tool that lets AI agents complete interactive CLI wizards autonomously.

**The problem:** AI coding agents (Claude Code, Cursor, etc.) can run shell commands, but they can't interact with prompts that wait for user input. Try telling Claude Code to run `npx workos` or `npx vercel` — it gets stuck at the first interactive prompt.

**The solution:** `noninteractive` spawns commands in a real PTY session and exposes read/send controls over a unix socket, so an agent can start the command, read what's on screen, decide what to type, and complete the flow autonomously.

```bash
# Start a session
npx noninteractive start workos

# Read what's on screen
npx noninteractive read workos
# ◆  Run the AuthKit installer?
# │  ● Yes / ○ No
# └

# Send Enter to confirm
npx noninteractive send workos ""

# Done? Stop it
npx noninteractive stop workos
```

It works with any interactive CLI — WorkOS, Vercel, Supabase, anything that uses prompts, select menus, or raw terminal mode.

**How it works:**

- `start` spawns a detached daemon that runs the target command inside a real pseudo-terminal (PTY)
- The daemon listens on a unix socket at `~/.noninteractive/sessions/<name>.sock`
- `read` and `send` connect to that socket to interact with the running process
- The PTY means the child process sees `isTTY=true` — ANSI colors work, @clack/prompts menus render, everything behaves like a real terminal

The PTY is allocated by a small Go binary (using github.com/creack/pty), cross-compiled for macOS and Linux. The rest is TypeScript running on Bun. No native deps, no python, just `npx noninteractive` and it works.

**Why this matters:**

Every devtool has a getting-started flow. Most of them are interactive. If an AI agent can't navigate your setup wizard, it can't use your product. We're using this tool to power [Agent Arena](https://2027.dev/arena) — a benchmark that sends Claude Code through every devtool's getting-started guide to measure how agent-friendly they are.

The age of "just read the docs" is ending. By 2027, the majority of your product's "users" will be autonomous agents setting up on behalf of developers. If your onboarding isn't machine-navigable, you're invisible.

More on this thesis: https://2027.dev/manifesto

GitHub: https://github.com/team2027/cli
npm: `npx noninteractive`
