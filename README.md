# noninteractive

Run interactive CLI login flows non-interactively. Built for AI agents (like Claude Code) that need to complete setup wizards, OAuth flows, and interactive installers without a human at the keyboard.

Spawns commands in a real PTY session, so programs that check `isTTY`, render select menus, or use raw terminal mode all work correctly.

## Install

```bash
npx noninteractive
```

## Usage

```bash
# Start a session (runs `npx workos` in a background PTY)
npx noninteractive start workos

# Read what's on screen
npx noninteractive read workos

# Send keystrokes (Enter to confirm a prompt)
npx noninteractive send workos ""

# Send text input
npx noninteractive send workos "my-api-key"

# Stop a session
npx noninteractive stop workos

# List active sessions
npx noninteractive list
```

## Example: WorkOS AuthKit setup

```bash
# Start the installer
npx noninteractive start workos

# Wait for it to load, then read the prompt
npx noninteractive read workos
# ◆  Run the AuthKit installer?
# │  ● Yes / ○ No
# └

# Press Enter to confirm "Yes"
npx noninteractive send workos ""

# Read the next prompt
npx noninteractive read workos
# ◆  You are on main. Create a feature branch?
# │  ● Create feat/add-workos-authkit
# │  ○ Continue on current branch
# │  ○ Cancel
# └

# Press Enter to confirm
npx noninteractive send workos ""

# Done? Stop the session
npx noninteractive stop workos
```

## How it works

1. `start` spawns a detached daemon process that runs the target command inside a real pseudo-terminal (PTY)
2. The daemon listens on a unix socket at `~/.noninteractive/sessions/<name>.sock`
3. `read`, `send`, and `stop` connect to that socket to interact with the running process
4. The PTY ensures the child process sees a real terminal — `isTTY` is true, ANSI colors work, interactive menus render correctly

## Why

AI coding agents can run shell commands, but they can't interact with prompts that wait for user input. This tool bridges that gap — the agent starts the command, reads the output, decides what to send, and completes the flow autonomously.
