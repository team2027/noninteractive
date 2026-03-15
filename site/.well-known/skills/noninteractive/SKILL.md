---
name: noninteractive
description: Run interactive CLI commands (setup wizards, login flows, installers) non-interactively using npx noninteractive. Use when you need to run a CLI tool that has interactive prompts, OAuth flows, or terminal-based menus that cannot be bypassed with flags.
compatibility: Requires Node.js 18+ or Bun. Works on macOS and Linux (x86_64, arm64).
allowed-tools: Bash(npx noninteractive *)
argument-hint: "<tool> [args...]"
metadata:
  author: 2027dev
  version: "1.6"
---

# noninteractive

Use `npx noninteractive` to drive interactive CLI tools without a human. It spawns commands in a real pseudo-terminal (PTY) and lets you send keystrokes and read output programmatically.

## When to use this skill

Use noninteractive when:
- A CLI tool requires interactive input (setup wizards, login flows, confirmation prompts)
- There is no `--yes`, `--non-interactive`, or `--headless` flag available
- The command uses terminal menus (@clack/prompts, inquirer, etc.)
- You need to complete an OAuth or authentication flow in a CLI

Do NOT use noninteractive when:
- The CLI tool has a non-interactive mode or `--yes` flag — use that instead
- You're running a simple command that doesn't need user input

## Quick start

If arguments were provided, run:

```bash
npx noninteractive $ARGUMENTS
```

Read the initial output, then drive the session using the workflow below.

## Commands

```
npx noninteractive <tool> [args...]                  # Start a session (runs npx <tool>)
npx noninteractive send <session> <text> --wait      # Send keystrokes, RETURNS output
npx noninteractive read <session> --wait             # Wait for output without sending
npx noninteractive stop <session>                    # Stop session
npx noninteractive list                              # Show active sessions
```

## Critical: `send` sends raw keystrokes

**`send` sends text exactly as-is — no Enter is auto-appended.** You must include `$'\r'` for Enter.

```bash
# Press Enter
npx noninteractive send <session> $'\r' --wait

# Type text + Enter
npx noninteractive send <session> $'my-project-name\r' --wait

# Type 'y' + Enter
npx noninteractive send <session> $'y\r' --wait

# Arrow down (no Enter — just navigates)
npx noninteractive send <session> $'\x1b[B' --wait

# Arrow down twice, then Enter to confirm
npx noninteractive send <session> $'\x1b[B\x1b[B\r' --wait
```

**`send --wait` returns the full terminal output.** You do NOT need to call `read` after `send --wait`.

The correct workflow is: **start → send --wait → send --wait → ... → stop**

Only use `read --wait` when you need to wait for output *without* sending anything (e.g., waiting for an OAuth callback).

## Special keys reference

```
$'\r'       Enter / Return
$'\x1b[A'   Arrow Up
$'\x1b[B'   Arrow Down
$'\x1b[C'   Arrow Right
$'\x1b[D'   Arrow Left
$'\t'       Tab
$'\x1b'     Escape
$'\x7f'     Backspace
```

You can combine multiple keys in one send: `$'\x1b[B\x1b[B\r'` = down, down, enter.

## Step-by-step workflow

### 1. Start a session

```bash
npx noninteractive <tool-name> [args...]
```

This runs `npx <tool-name>` in a background PTY. The session name is the tool name (e.g., `npx noninteractive workos` → session `workos`). The start command prints initial output.

**Prefer the simple form.** Pass the tool directly: `npx noninteractive sanity@latest login`, not `npx noninteractive -- npx sanity@latest login`. The session name is derived from the first argument, so using `-- npx` would name the session `npx` instead of `sanity`.

**First run may be slow**: If npx needs to install the package, the first command can take 30-60+ seconds. Use `--timeout 60000` (or higher) on your first `send --wait` or `read --wait`.

### 2. Send input and get response

```bash
# Press Enter (confirm/select current option), get response
npx noninteractive send <session> $'\r' --wait

# Type text and press Enter, get response
npx noninteractive send <session> $'my-project-name\r' --wait

# Navigate down two options, then confirm
npx noninteractive send <session> $'\x1b[B\x1b[B\r' --wait

# Just navigate without confirming
npx noninteractive send <session> $'\x1b[B' --wait
```

**Do not call `read` after `send --wait`** — the output is already in the response.

### 3. Wait without sending (OAuth flows, long operations)

```bash
npx noninteractive read <session> --wait --timeout 60000
```

Use `read --wait` only when waiting for something to happen without sending input — e.g., waiting for an OAuth callback or a long build.

### 4. Stop the session

```bash
npx noninteractive stop <session>
```

## Complete example: WorkOS CLI setup

```bash
# Start the WorkOS installer (prints initial output)
npx noninteractive workos
# Output: ◆  Run the AuthKit installer?  │  ● Yes / ○ No  └

# Press Enter to select "Yes" — response includes next prompt
npx noninteractive send workos $'\r' --wait
# Output: ◆  You are on main. Create a feature branch?  │  ● Create feat/add-workos-authkit  └

# Press Enter to confirm — response includes next prompt
npx noninteractive send workos $'\r' --wait

# Type API key + Enter — response includes next prompt
npx noninteractive send workos $'my-api-key\r' --wait

# Done
npx noninteractive stop workos
```

## Important details

- **`send --wait` returns output**: Do not follow it with `read`. The output is already there.
- **No auto-Enter**: `send` sends text exactly as-is. Include `$'\r'` when you want to press Enter.
- **ANSI codes stripped**: Output is clean text — no escape sequences to parse.
- **First run timeout**: npx may need to install the package. Use `--timeout 60000` or higher on the first wait.
- **Output accumulates**: Output contains ALL text since session start. Look at the end for the latest prompt.
- **Sessions persist**: Sessions run as background daemons. Use `list` to see active sessions.
- **Parallel sessions**: If a session name is already taken, a suffix is added automatically (e.g., `eslint`, `eslint-2`, `eslint-3`).
- **Real PTY**: The child process sees `isTTY=true`. Terminal menus and raw mode work correctly.
- **Default timeout**: `--wait` defaults to 30s. Use `--timeout <ms>` to change.
- **OAuth URLs auto-open**: URLs detected in output are automatically opened in the browser. Use `--no-open` to disable.

## Handling common patterns

### Arrow key navigation

Use escape sequences to navigate menus. Arrow keys alone do NOT confirm — send `$'\r'` separately to confirm.

```bash
# Move down and confirm
npx noninteractive send <session> $'\x1b[B\r' --wait

# Move down twice without confirming
npx noninteractive send <session> $'\x1b[B\x1b[B' --wait
```

### OAuth/browser flows
URLs detected in output are automatically opened in the user's browser. The CLI intercepts `open`/`xdg-open` calls and scans output for URLs.

1. Start the session — any OAuth URL will be auto-opened in the browser
2. Tell the user to complete authentication in the opened browser tab
3. Use `read --wait --timeout 60000` to block until the CLI detects the completed auth

Use `--no-open` to disable auto-opening (URLs are still shown in stderr).

### Multiple sessions
```bash
npx noninteractive vercel
npx noninteractive workos
npx noninteractive list  # Shows both sessions
```
