import { expect, test } from "bun:test";
import { isAuthUrl, stripTrailingPunctuation } from "./urls";

test("strips a trailing sentence period", () => {
	expect(stripTrailingPunctuation("https://x.com/releases.")).toBe(
		"https://x.com/releases",
	);
});

test("strips other trailing punctuation", () => {
	expect(stripTrailingPunctuation("https://x.com/a,")).toBe("https://x.com/a");
	expect(stripTrailingPunctuation("https://x.com/a;")).toBe("https://x.com/a");
	expect(stripTrailingPunctuation("https://x.com/a!?")).toBe("https://x.com/a");
});

test("leaves a clean url untouched", () => {
	expect(stripTrailingPunctuation("https://github.com/a/b")).toBe(
		"https://github.com/a/b",
	);
});

test("preserves internal dots", () => {
	expect(stripTrailingPunctuation("https://api.example.com/v1.0/x")).toBe(
		"https://api.example.com/v1.0/x",
	);
});

test("flags auth-flow urls", () => {
	expect(isAuthUrl("https://github.com/login/device")).toBe(true);
	expect(isAuthUrl("https://accounts.google.com/o/oauth2/auth")).toBe(true);
	expect(isAuthUrl("https://example.com/callback?code=1")).toBe(true);
});

test("does not flag incidental non-auth urls", () => {
	expect(isAuthUrl("https://github.com/daytonaio/daytona/releases")).toBe(
		false,
	);
	expect(isAuthUrl("https://docs.example.com/getting-started")).toBe(false);
});
