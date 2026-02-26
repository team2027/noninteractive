# 2027 CLI

Session wrapper for interactive CLI commands. Lets claude code run interactive login flows non-interactively.

## Architecture

- `src/index.ts` — CLI entry point, arg parsing, auto-start flow
- `src/daemon.ts` — detached daemon per session, spawns target command, unix socket server
- `src/client.ts` — connects to daemon via unix socket, sends JSON commands
- `src/paths.ts` — session dir/socket path helpers
- `src/ptybridge.py` — python3 PTY bridge, allocates real terminal for child process

Sessions stored at `~/.2027/sessions/<name>.sock`. Protocol is JSON over unix socket.

## Commands

```
2027 start <name> [args...]   # start session (runs npx <name> in a PTY)
2027 read  <name>             # read terminal output
2027 send  <name> <text>      # send keystrokes to session
2027 stop  <name>             # stop a session
2027 list                     # show active sessions (alias: ls)
```

## Build

```
bun run build    # compiles to bin/2027 standalone binary
```

## Notes

- daemon uses node:child_process and node:net (not Bun-specific APIs) for subprocess/socket — needed for detached spawn and unix socket server
- PTY via python3 ptybridge.py — allocates a real pseudo-terminal so child processes see isTTY=true
- compiled binary is ~55MB (includes bun runtime)
- ptybridge.py must be co-located with the binary (or in src/ during dev)

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
