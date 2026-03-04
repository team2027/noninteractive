import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const SESSIONS_DIR = resolve(
	process.env.HOME!,
	".noninteractive",
	"sessions",
);

export function ensureSessionsDir() {
	mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function socketPath(name: string) {
	return resolve(SESSIONS_DIR, `${name}.sock`);
}
