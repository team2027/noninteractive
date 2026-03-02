---
name: noninteractive
description: Run interactive CLI commands (setup wizards, login flows, installers) non-interactively using npx noninteractive. Use when you need to run a CLI tool that has interactive prompts, OAuth flows, or terminal-based menus that cannot be bypassed with flags.
compatibility: Requires Node.js 18+ or Bun. Works on macOS and Linux (x86_64, arm64).
metadata:
  author: 2027dev
  version: "1.0"
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
npx noninteractive start <cmd> [args...]   # Start a session
npx noninteractive read  <session>         # Read terminal output
npx noninteractive send  <session> <text>  # Send keystrokes
npx noninteractive stop  <session>         # Stop session
npx noninteractive list                    # Show active sessions
```

## Step-by-step workflow

### 1. Start a session

```bash
npx noninteractive start npx <tool-name>
```

The first argument after `start` is the command to run. The session name is auto-derived from the command (e.g., `npx vercel` becomes session `vercel`, `npx workos` becomes `workos`).

You can also pass arguments:
```bash
npx noninteractive start npx workos login
npx noninteractive start npx vercel deploy
```

### 2. Read terminal output

```bash
npx noninteractive read <session>
```

This returns the full terminal output. Read it to understand what the CLI is asking for. Look for:
- Selection menus (use arrow keys or enter)
- Yes/No prompts
- Text input fields
- URLs to open (for OAuth flows)

### 3. Send input

```bash
# Press Enter (confirm/select current option)
npx noninteractive send <session> ""

# Type text and press Enter
npx noninteractive send <session> "my-project-name"

# Type 'y' to confirm
npx noninteractive send <session> "y"
```

Every `send` appends a carriage return (Enter key) after the text. Sending `""` (empty string) is equivalent to pressing Enter.

### 4. Read again after sending

Always read output after sending input to see the result:
```bash
npx noninteractive read <session>
```

### 5. Repeat until done

Continue the read → decide → send loop until the CLI flow is complete.

### 6. Stop the session

```bash
npx noninteractive stop <session>
```

## Complete example: WorkOS CLI setup

```bash
# Start the WorkOS installer
npx noninteractive start npx workos

# Read what's on screen
npx noninteractive read workos
# Output: ◆  Run the AuthKit installer?
#         │  ● Yes / ○ No
#         └

# Press Enter to select "Yes"
npx noninteractive send workos ""

# Read next prompt
npx noninteractive read workos
# Output: ◆  You are on main. Create a feature branch?
#         │  ● Create feat/add-workos-authkit
#         └

# Press Enter to confirm
npx noninteractive send workos ""

# Continue reading and responding...
npx noninteractive read workos

# When done, stop the session
npx noninteractive stop workos
```

## Important details

- **Session names**: Auto-derived from the command. `npx vercel` → `vercel`, `npx workos` → `workos`. The `npx`/`bunx` prefix and flags like `-y` are stripped.
- **Output accumulates**: `read` returns ALL output since the session started, not just new output. You may need to look at the end of the output for the latest prompt.
- **Send always appends Enter**: Every `send` adds a carriage return. To just press Enter, send an empty string `""`.
- **Sessions persist**: Sessions run as background daemons. They survive even if your process exits. Use `list` to see active sessions.
- **Real PTY**: The child process sees `isTTY=true`. Terminal menus, colors, and raw mode all work correctly.
- **Wait between send and read**: After sending input, wait a moment before reading to give the CLI time to process and render the next prompt. A 1-2 second pause is usually sufficient.

## Handling common patterns

### Arrow key navigation
For CLI menus that require arrow keys, you may need to send arrow key escape sequences. However, most modern CLI prompts accept Enter to confirm the current selection.

### OAuth/browser flows
If the CLI prints a URL to open for authentication:
1. Read the output to find the URL
2. Tell the user to open the URL and complete authentication
3. Continue reading output — the CLI will usually detect the completed auth and proceed

### Multiple sessions
You can run multiple sessions simultaneously:
```bash
npx noninteractive start npx vercel
npx noninteractive start npx workos
npx noninteractive list  # Shows both sessions
```
