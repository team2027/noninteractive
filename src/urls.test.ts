import { expect, test } from "bun:test";
import {
	announcesSelfOpen,
	extractUrls,
	isAuthUrl,
	isAutoOpenUrl,
	pickAutoOpenUrl,
	stripTrailingPunctuation,
} from "./urls";

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

test("auto-opens high-confidence auth urls", () => {
	expect(isAutoOpenUrl("https://github.com/login/device")).toBe(true);
	expect(isAutoOpenUrl("https://example.com/activate?user_code=ABCD")).toBe(
		true,
	);
	expect(isAutoOpenUrl("https://accounts.google.com/o/oauth2/auth")).toBe(true);
	expect(isAutoOpenUrl("https://example.com/authorize?client_id=1")).toBe(true);
	expect(isAutoOpenUrl("https://example.com/callback?code=1")).toBe(true);
	// supabase cli login: /dashboard/cli/login (slash, not the cli-auth hyphen)
	expect(
		isAutoOpenUrl(
			"https://supabase.com/dashboard/cli/login?session_id=x&token_name=cli_y&public_key=z",
		),
	).toBe(true);
	// stack-auth + stripe paths (not live-tested, lock them in)
	expect(
		isAutoOpenUrl("https://app.stack-auth.com/handler/cli-auth-confirm?login_code=x"),
	).toBe(true);
	expect(
		isAutoOpenUrl("https://dashboard.stripe.com/stripecli/confirm_auth?t=x"),
	).toBe(true);
});

test("does not auto-open docs/signup/marketing/release urls", () => {
	// auth0 prints a signup link alongside the device url — never open it
	expect(isAutoOpenUrl("https://auth0.com/signup")).toBe(false);
	// daytona prints a github releases nag — never open it
	expect(
		isAutoOpenUrl("https://github.com/daytonaio/daytona/releases"),
	).toBe(false);
	expect(isAutoOpenUrl("https://docs.example.com/getting-started")).toBe(false);
	// bare /login (a marketing/login landing page) is not high-confidence enough
	expect(isAutoOpenUrl("https://app.example.com/login")).toBe(false);
	// broad tokens anchored to a path-segment boundary: incidental compound
	// paths must not match (issue #10 spurious tab)
	expect(isAutoOpenUrl("https://docs.example.com/device-management")).toBe(
		false,
	);
	expect(isAutoOpenUrl("https://billing.example.com/activate-plan")).toBe(false);
});

test("picks the first auth url, skipping junk", () => {
	const urls = [
		"https://auth0.com/signup",
		"https://docs.auth0.com/cli",
		"https://example.auth0.com/activate?user_code=WXYZ",
		"https://example.com/authorize?client_id=2",
	];
	expect(pickAutoOpenUrl(urls)).toBe(
		"https://example.auth0.com/activate?user_code=WXYZ",
	);
});

test("detects a CLI self-opening the browser (railway)", () => {
	expect(
		announcesSelfOpen("→ Opening your browser to sign in — finish there."),
	).toBe(true);
	expect(announcesSelfOpen("Launching browser…")).toBe(true);
	expect(announcesSelfOpen("Opening github.com in your browser.")).toBe(true);
});

test("detects supabase's 'open browser … automatically' self-open", () => {
	expect(
		announcesSelfOpen("Press Enter to open browser and login automatically."),
	).toBe(true);
});

test("does NOT flag auth0's past-tense 'opened browser window' as self-open", () => {
	// auth0 prints this but relies on US to open (its open is suppressed by the
	// shim). matching it would wrongly skip auth0's device url → broken login.
	expect(
		announcesSelfOpen("Verify ABCD-1234 in the opened browser window."),
	).toBe(false);
});

test("does NOT flag passive 'press enter to open browser' as self-open", () => {
	// passive 'open browser' with no 'automatically' / 'opening' → not a self-open
	expect(announcesSelfOpen("Press Enter to open the browser to log in.")).toBe(
		false,
	);
	expect(announcesSelfOpen("We couldn't open the browser for you.")).toBe(false);
});

test("picks nothing when no auth url is present", () => {
	expect(
		pickAutoOpenUrl([
			"https://auth0.com/signup",
			"https://github.com/x/y/releases",
		]),
	).toBeUndefined();
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

test("splits two adjacent links separated only by color codes", () => {
	expect(
		extractUrls(
			"\x1b[34mhttps://x.com/a\x1b[0m\x1b[34mhttps://x.com/b\x1b[0m",
		),
	).toEqual(["https://x.com/a", "https://x.com/b"]);
});

test("keeps a url that embeds a scheme in a query param intact", () => {
	// no escape separates the two schemes, so it must NOT be split — a common
	// oauth shape with an unencoded redirect_uri
	expect(
		extractUrls(
			"https://auth.acme.com/authorize?redirect_uri=https://app.acme.com/cb&state=x",
		),
	).toEqual([
		"https://auth.acme.com/authorize?redirect_uri=https://app.acme.com/cb&state=x",
	]);
});

test("extracts multiple urls and strips punctuation", () => {
	expect(
		extractUrls("a https://x.com/a, then https://x.com/login/device."),
	).toEqual(["https://x.com/a", "https://x.com/login/device"]);
});
