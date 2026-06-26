export const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

// urls that look like an interactive auth flow — used to *hint* which printed
// url an agent should open, never to gate what gets surfaced
const AUTH_URL_RE = /oauth|authorize|device|login|callback/i;

// the url char class doesn't exclude sentence punctuation, so a match can swallow
// a trailing "." etc — e.g. "…/releases." → a 404. trim it off the end.
export function stripTrailingPunctuation(url: string): string {
	return url.replace(/[.,;:!?'"]+$/, "");
}

export function isAuthUrl(url: string): boolean {
	return AUTH_URL_RE.test(url);
}
