import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const SESSIONS_DIR = resolve(homedir(), ".noninteractive", "sessions");

export function ensureSessionsDir() {
	mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function socketPath(name: string) {
	return resolve(SESSIONS_DIR, `${name}.sock`);
}
