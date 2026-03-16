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

export function sessionDir(name: string) {
	return resolve(SESSIONS_DIR, name);
}

export function sessionBinDir(name: string) {
	return resolve(SESSIONS_DIR, name, "bin");
}

export function sessionUrlsFile(name: string) {
	return resolve(SESSIONS_DIR, name, "urls");
}

export function sessionOutputFile(name: string) {
	return resolve(SESSIONS_DIR, `${name}.output`);
}
