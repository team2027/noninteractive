// Should `send` warn that the text was typed without a submitting Enter?
//
// `send` transmits keystrokes literally with no auto-appended Enter, so a value
// typed without a trailing \r just sits at the prompt unsubmitted — the single
// biggest thing agents have to reverse-engineer (it turned a 17s run into 62s in
// an eval). Warn only when there's visible typed content and no submit char;
// pure arrow-key / escape sends (menu navigation that intentionally omits Enter)
// must NOT trip it. Takes the text AFTER C-escape parsing (real control bytes).
export function needsEnterHint(parsedText: string): boolean {
	if (/[\r\n]$/.test(parsedText)) return false;
	const visibleTyped = parsedText
		.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") // CSI sequences (arrows, etc)
		.replace(/[\x00-\x1f\x7f]/g, ""); // remaining control chars incl \r \n \t \x1b
	return /\S/.test(visibleTyped);
}
