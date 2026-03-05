---
name: noninteractive
description: Run interactive CLI commands (setup wizards, login flows, installers) non-interactively using npx noninteractive. Use when you need to run a CLI tool that has interactive prompts, OAuth flows, or terminal-based menus that cannot be bypassed with flags.
compatibility: Requires Node.js 18+ or Bun. Works on macOS and Linux (x86_64, arm64).
metadata:
  author: 2027dev
  version: "1.2"
---

# noninteractive

Use `npx noninteractive` to drive interactive CLI tools without a human. It spawns commands in a real pseudo-terminal (PTY) and lets you read output and send keystrokes programmatically.

## When to use this skill

Use noninteractive when:
- A CLI tool requires interactive input (setup wizards, login flows, confirmation prompts)
- There is no `--yes`, `--non-interactive`, or `--headless` flag available
- The command uses terminal menus (@clack/prompts, inquirer, etc.)
- You need to complete an OAuth or authentication flow in a CLI

Do NOT use noninteractive when:
- The CLI tool has a non-interactive mode or `--yes` flag — use that instead
- You're running a simple command that doesn't need user input

## Commands

```
npx noninteractive <tool> [args...]                  # Start a session (runs npx <tool>)
npx noninteractive send <session> <text> [--wait]    # Send keystrokes (--wait for response)
npx noninteractive read <session> [--wait]           # Read terminal output (--wait blocks)
npx noninteractive stop <session>                    # Stop session
npx noninteractive list                              # Show active sessions
```

## Step-by-step workflow

**Always use `--wait` flag** on `send` and `read` to avoid polling. This blocks until new output appears, saving tool calls and tokens.

### 1. Start a session

```bash
npx noninteractive <tool-name>
```

This runs `npx <tool-name>` in a background PTY. The session name is the tool name (e.g., `npx noninteractive workos` → session `workos`). The start command already reads and prints initial output.

### 2. Send input and wait for response

```bash
# Press Enter (confirm/select current option) and wait for next prompt
npx noninteractive send <session> "" --wait

# Type text and press Enter, wait for response
npx noninteractive send <session> "my-project-name" --wait

# Type 'y' to confirm, wait for response
npx noninteractive send <session> "y" --wait
```

`send --wait` sends the keystrokes, then blocks until new output appears. This replaces the old pattern of `send` + polling `read` in a loop.

Every `send` appends a carriage return (Enter key) after the text. Sending `""` (empty string) is equivalent to pressing Enter.

### 3. Wait for output without sending (OAuth flows, long operations)

```bash
npx noninteractive read <session> --wait
```

Use `read --wait` when you need to wait for output without sending input — for example, waiting for an OAuth callback to complete or a long operation to finish.

### 4. Repeat until done

Continue the send → wait cycle until the CLI flow is complete.

### 5. Stop the session

```bash
npx noninteractive stop <session>
```

## Complete example: WorkOS CLI setup

```bash
# Start the WorkOS installer (prints initial output)
npx noninteractive workos
# Output: ◆  Run the AuthKit installer?
#         │  ● Yes / ○ No
#         └

# Press Enter to select "Yes", wait for next prompt
npx noninteractive send workos "" --wait
# Output: ◆  You are on main. Create a feature branch?
#         │  ● Create feat/add-workos-authkit
#         └

# Press Enter to confirm, wait for response
npx noninteractive send workos "" --wait

# Continue sending and waiting...
npx noninteractive send workos "my-api-key" --wait

# When done, stop the session
npx noninteractive stop workos
```

## Important details

- **Session names**: Auto-derived from the tool name. `workos` → session `workos`, `vercel` → session `vercel`.
- **Output accumulates**: `read` returns ALL output since the session started, not just new output. Look at the end for the latest prompt.
- **Send always appends Enter**: Every `send` adds a carriage return. To just press Enter, send an empty string `""`.
- **Use --wait**: Always prefer `send --wait` over separate `send` + `read` calls. It's faster and uses fewer tool calls.
- **Sessions persist**: Sessions run as background daemons. They survive even if your process exits. Use `list` to see active sessions.
- **Real PTY**: The child process sees `isTTY=true`. Terminal menus, colors, and raw mode all work correctly.
- **Timeout**: `--wait` defaults to 30s timeout. Use `--timeout <ms>` to change it.

## Handling common patterns

### Arrow key navigation
For CLI menus that require arrow keys, you may need to send arrow key escape sequences. However, most modern CLI prompts accept Enter to confirm the current selection.

### OAuth/browser flows
If the CLI prints a URL to open for authentication:
1. Read the output to find the URL
2. Tell the user to open the URL and complete authentication
3. Use `read --wait` to block until the CLI detects the completed auth and proceeds

### Multiple sessions
You can run multiple sessions simultaneously:
```bash
npx noninteractive vercel
npx noninteractive workos
npx noninteractive list  # Shows both sessions
```
