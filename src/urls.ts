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
// links) never pop a browser tab during a login flow (issue #10). the broad
// tokens (device/activate/callback) are anchored to a path-segment boundary so
// incidental urls like "…/device-management" or "…/activate-plan" don't match.
const AUTO_OPEN_RE =
	/authorize|oauth|\/device(?:login)?(?=[/?#]|$)|\/activate(?=[/?#]|$)|confirm_auth|cli-auth|cli\/login|\/callback(?=[/?#]|$)|login_code|token-flow|stripecli/i;

// the url char class doesn't exclude sentence punctuation, so a match can swallow
// a trailing "." etc — e.g. "…/releases." → a 404. trim it off the end.
export function stripTrailingPunctuation(url: string): string {
	return url.replace(/[.,;:!?'"]+$/, "");
}

// pull clean urls out of a (possibly ANSI-colored) chunk of terminal output.
// an escape sequence is dropped when it sits mid-url (so a color reset spliced
// into a link rejoins it) but replaced with a space when a new scheme follows it
// (so two adjacent colored links don't glue into one). this keeps a real url
// that embeds a scheme in a query param — e.g. "?redirect_uri=https://app/cb" —
// intact, since no escape separates the two schemes there. then trims trailing
// sentence punctuation off each match.
export function extractUrls(text: string): string[] {
	const cleaned = text.replace(ANSI_RE, (match, offset: number) =>
		/^https?:\/\//.test(text.slice(offset + match.length)) ? " " : "",
	);
	const matches = cleaned.match(URL_RE);
	if (!matches) return [];
	return matches.map(stripTrailingPunctuation).filter(Boolean);
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
