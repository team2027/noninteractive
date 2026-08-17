import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { ptyBridgeBinaryName } from "./daemon";

// node's process.arch ("x64") and Go's GOARCH ("amd64") only agree on arm64, so
// the binary name must be built from the GOARCH mapping — else 64-bit intel/amd
// hosts (incl. the linux-x64 eval sandbox) look for a file that doesn't exist.
test("maps node arch to the shipped GOARCH binary name", () => {
	expect(ptyBridgeBinaryName("linux", "x64")).toBe("ptybridge-linux-amd64");
	expect(ptyBridgeBinaryName("darwin", "x64")).toBe("ptybridge-darwin-amd64");
	expect(ptyBridgeBinaryName("linux", "arm64")).toBe("ptybridge-linux-arm64");
	expect(ptyBridgeBinaryName("darwin", "arm64")).toBe("ptybridge-darwin-arm64");
});

// every host we ship for must resolve to a real binary on disk. this is the test
// that would have caught the linux-x64 miss from a darwin-arm64 dev machine.
test("every shipped platform/arch resolves to a real native binary", () => {
	const targets: Array<[string, string]> = [
		["linux", "x64"],
		["linux", "arm64"],
		["darwin", "x64"],
		["darwin", "arm64"],
	];
	for (const [platform, arch] of targets) {
		const name = ptyBridgeBinaryName(platform, arch);
		const path = resolve(import.meta.dirname, "..", "native", name);
		expect(existsSync(path)).toBe(true);
	}
});
