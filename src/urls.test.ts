import { expect, test } from "bun:test";
import { extractUrls, isAuthUrl, stripTrailingPunctuation } from "./urls";

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
	expect(isAuthUrl("https://example.com/activate?user_code=ABCD")).toBe(true);
});

test("flags bare /auth, signin and sso endpoints", () => {
	expect(isAuthUrl("https://id.example.com/auth?response_type=code")).toBe(true);
	expect(isAuthUrl("https://id.example.com/auth")).toBe(true);
	expect(isAuthUrl("https://example.com/signin")).toBe(true);
	expect(isAuthUrl("https://example.com/sign-in")).toBe(true);
	expect(isAuthUrl("https://example.com/sso/start")).toBe(true);
});

test("does not flag incidental non-auth urls", () => {
	expect(isAuthUrl("https://github.com/daytonaio/daytona/releases")).toBe(
		false,
	);
	expect(isAuthUrl("https://docs.example.com/getting-started")).toBe(false);
	expect(isAuthUrl("https://example.com/authors/jane")).toBe(false);
});

test("strips an osc-8 hyperlink wrapper instead of swallowing escape bytes", () => {
	// osc-8 hyperlink whose visible text is the url itself → url survives clean
	expect(
		extractUrls(
			"\x1b]8;;https://x.com/login/device\x1b\\https://x.com/login/device\x1b]8;;\x1b\\",
		),
	).toEqual(["https://x.com/login/device"]);
	// BEL-terminated osc form is stripped too (no garbled escape bytes remain)
	expect(extractUrls("\x1b]8;;https://x.com/a\x07link\x1b]8;;\x07")).toEqual([]);
});

test("strips a trailing ANSI reset off a colored url", () => {
	expect(extractUrls("\x1b[34mhttps://x.com/releases\x1b[0m")).toEqual([
		"https://x.com/releases",
	]);
});

test("strips ANSI reset and trailing period together", () => {
	expect(extractUrls("see \x1b[34mhttps://x.com/releases.\x1b[0m now")).toEqual(
		["https://x.com/releases"],
	);
});

test("rejoins a url broken by a mid-string color reset", () => {
	expect(extractUrls("https://x.com/\x1b[0mreleases")).toEqual([
		"https://x.com/releases",
	]);
});

test("extracts multiple urls and strips punctuation", () => {
	expect(
		extractUrls("a https://x.com/a, then https://x.com/login/device."),
	).toEqual(["https://x.com/a", "https://x.com/login/device"]);
});
