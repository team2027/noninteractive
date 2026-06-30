const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// terminal escape sequences the url char class would otherwise swallow into a
// match. covers OSC (\x1b]…BEL or \x1b]…ST — e.g. osc-8 hyperlinks, which wrap
// the url in escape bytes) and CSI (\x1b[…m colors / cursor moves). osc is
// matched first so its payload isn't mistaken for a bare CSI sequence.
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]/g;

// urls that look like an interactive auth flow — broad, used only to *label* a
// surfaced url as "[login url]" (never to gate what gets surfaced or opened).
// matches the common auth path shapes; "\/auth(...)" is anchored so it doesn't
// fire on "/authors".
const AUTH_URL_RE =
	/oauth|authorize|device|activate|login|signin|sign-in|sso|callback|\/auth(?:[/?#]|$)/i;

// tight, high-confidence auth pattern used to decide what to AUTO-OPEN. only
// real interactive-auth endpoints — deliberately excludes bare "login" so
// signup/docs/marketing/release pages (auth0 signup, daytona releases nag, doc
// links) never pop a browser tab during a login flow (issue #10).
const AUTO_OPEN_RE =
	/authorize|activate|oauth|device|confirm_auth|cli-auth|cli\/login|\/callback|login_code|token-flow|stripecli/i;

// the url char class doesn't exclude sentence punctuation, so a match can swallow
// a trailing "." etc — e.g. "…/releases." → a 404. trim it off the end.
export function stripTrailingPunctuation(url: string): string {
	return url.replace(/[.,;:!?'"]+$/, "");
}

// pull clean urls out of a (possibly ANSI-colored) chunk of terminal output.
// strips escapes first so a trailing reset (\x1b[0m) or a mid-url color code
// can't end up inside the match, then trims trailing sentence punctuation.
export function extractUrls(text: string): string[] {
	const matches = text.replace(ANSI_RE, "").match(URL_RE);
	if (!matches) return [];
	const urls: string[] = [];
	for (const match of matches) {
		// stripping escapes can glue two adjacent links that were only separated
		// by color codes (e.g. "…a.com\x1b[0m\x1b[34mhttps://b.com") into one
		// match — re-split on any embedded scheme so each url comes out whole.
		for (const part of match.split(/(?=https?:\/\/)/)) {
			const url = stripTrailingPunctuation(part);
			if (url) urls.push(url);
		}
	}
	return urls;
}

export function isAuthUrl(url: string): boolean {
	return AUTH_URL_RE.test(url);
}

// should this url be auto-opened in a browser? only high-confidence auth urls.
export function isAutoOpenUrl(url: string): boolean {
	return AUTO_OPEN_RE.test(url);
}

// a CLI announcing it is opening the browser ITSELF, right now — used as a
// fallback to avoid double-opening a url the CLI opens via a path the shim can't
// intercept (railway/supabase use native macOS open, bypassing PATH+$BROWSER).
// deliberately matches ONLY present-continuous "opening/launching … browser"
// (the action happening now → a window will appear). it must NOT match auth0's
// past-tense "Verify XXXX in opened browser window" (auth0 relies on US to open,
// its own open is suppressed by the shim) nor passive "press enter to open
// browser" — neither means a real window appeared.
const SELF_OPEN_RE = /\b(?:opening|launching)\b[^\n]{0,40}\bbrowser\b/i;

// some CLIs (supabase) use a passive verb but say it happens "automatically" —
// "press enter to open browser and login automatically" — which still means the
// CLI opens its own tab. "browser … automatically" (either order) is specific
// enough not to fire on auth0's "in the opened browser window".
const SELF_OPEN_AUTO_RE =
	/\bbrowser\b[^\n]{0,40}\bautomatically\b|\bautomatically\b[^\n]{0,40}\bbrowser\b/i;

export function announcesSelfOpen(text: string): boolean {
	return SELF_OPEN_RE.test(text) || SELF_OPEN_AUTO_RE.test(text);
}

// pick the single url to auto-open from a batch: the FIRST high-confidence auth
// url. returns undefined when none qualify (so nothing pops). when more than one
// auth url is present we open only the first — login flows want one tab, not a
// scatter (issue #10).
export function pickAutoOpenUrl(urls: string[]): string | undefined {
	return urls.find(isAutoOpenUrl);
}
