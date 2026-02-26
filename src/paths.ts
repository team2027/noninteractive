import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

export const SESSIONS_DIR = resolve(process.env.HOME!, ".2027", "sessions");

export function ensureSessionsDir() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function socketPath(name: string) {
  return resolve(SESSIONS_DIR, `${name}.sock`);
}
