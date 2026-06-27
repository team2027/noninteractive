const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// CSI escape sequences (color, cursor moves, resets like \x1b[0m). A colored
// link in terminal output ends with one of these, and the url char class would
// otherwise swallow the escape bytes into the match.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// urls that look like an interactive auth flow — used to *hint* which printed
// url an agent should open, never to gate what gets surfaced
const AUTH_URL_RE = /oauth|authorize|device|activate|login|callback/i;

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
	return matches.map(stripTrailingPunctuation);
}

export function isAuthUrl(url: string): boolean {
	return AUTH_URL_RE.test(url);
}
