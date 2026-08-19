import { expect, test } from "bun:test";
import { needsEnterHint } from "./input";

test("warns on typed content with no Enter", () => {
	expect(needsEnterHint("hello")).toBe(true);
	expect(needsEnterHint("2")).toBe(true); // menu selection typed without Enter
	expect(needsEnterHint("y")).toBe(true);
});

test("does not warn when text submits (trailing \\r or \\n)", () => {
	expect(needsEnterHint("hello\r")).toBe(false);
	expect(needsEnterHint("y\r")).toBe(false);
	expect(needsEnterHint("hello\n")).toBe(false);
});

test("does not warn on pure navigation keys (no visible typed content)", () => {
	expect(needsEnterHint("\x1b[B")).toBe(false); // arrow down
	expect(needsEnterHint("\x1b[A")).toBe(false); // arrow up
	expect(needsEnterHint("\x1b")).toBe(false); // bare escape
	expect(needsEnterHint("\x1b[B\r")).toBe(false); // arrow then Enter (submitted)
	expect(needsEnterHint("")).toBe(false); // empty
	expect(needsEnterHint("\t")).toBe(false); // tab only
});
