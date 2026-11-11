/**
 * Turn a GitLab Markdown description into readable plain text for the standup screen.
 *
 * Deliberately not a Markdown renderer: output is shown with Svelte's normal text
 * escaping, so there is no HTML injection surface at all. It keeps the words, line
 * breaks, list bullets and checkboxes, and drops syntax noise.
 */
/**
 * Only this much raw Markdown is converted. Far more than is ever shown (the board cuts at 2,500
 * characters), and it bounds the work per description no matter how large it is: GitLab allows
 * 1 MB, and a hostile description must not stall the server for everyone (review M5).
 */
export const MARKDOWN_INPUT_MAX = 20_000;

/** Remove <!-- … --> comments with a single forward scan (a regex here backtracks on unclosed ones). */
function stripComments(s: string): string {
	let out = '';
	let i = 0;
	for (;;) {
		const start = s.indexOf('<!--', i);
		if (start === -1) return out + s.slice(i);
		out += s.slice(i, start);
		const end = s.indexOf('-->', start + 4);
		if (end === -1) return out; // unclosed: GitLab hides the rest too
		i = end + 3;
	}
}

/** Drop ``` fence lines but keep the code, line by line (linear, unlike a multi-line regex). */
function unfence(s: string): string {
	return s
		.split('\n')
		.filter((line) => !/^```/.test(line))
		.join('\n');
}

/**
 * Every pattern below is bounded ({0,N}) or anchored to one line, so the whole conversion stays
 * linear in the input: no pattern can rescan to the end of the text from each starting point.
 */
export function markdownToText(md: string | null | undefined): string {
	if (!md) return '';
	let s = md.slice(0, MARKDOWN_INPUT_MAX).replace(/\r\n?/g, '\n');

	s = stripComments(s); // HTML comments (issue templates are full of them)
	s = unfence(s); // fenced code: keep the code
	s = s.replace(/!\[([^\]\n]{0,300})\]\([^)\n]{0,2000}\)/g, (_, alt: string) => (alt ? `[image: ${alt}]` : '[image]'));
	s = s.replace(/\[([^\]\n]{1,300})\]\([^)\n]{0,2000}\)/g, '$1'); // links: keep the text
	s = s.replace(/<\/?[a-z][^>\n]{0,300}>/gi, ''); // inline HTML tags (e.g. <details>, <br>)
	s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // heading markers
	s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, ''); // blockquote markers
	s = s.replace(/^([ \t]{0,40})[-*+][ \t]+\[[xX]\][ \t]+/gm, '$1☑ '); // done task
	s = s.replace(/^([ \t]{0,40})[-*+][ \t]+\[ \][ \t]+/gm, '$1☐ '); // open task
	s = s.replace(/^([ \t]{0,40})[-*+][ \t]+/gm, '$1• '); // bullets
	s = s.replace(/(\*\*|__)([^\n]{1,300}?)\1/g, '$2'); // bold
	s = s.replace(/(^|[\s(])[*_]([^*_\n]{1,300})[*_](?=[\s).,!?:;]|$)/gm, '$1$2'); // italic
	s = s.replace(/~~([^\n]{1,300}?)~~/g, '$1'); // strikethrough
	s = s.replace(/`([^`\n]{1,300})`/g, '$1'); // inline code
	s = s.replace(/^[ \t]{0,40}([-*_])(?:[ \t]{0,10}\1){2,200}[ \t]*$/gm, ''); // horizontal rules
	s = s.replace(/[ \t]+$/gm, '');
	s = s.replace(/\n{3,}/g, '\n\n');
	return s.trim();
}

/** Cut at a word boundary near `max` characters. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false };
	const cut = text.slice(0, max);
	const space = cut.lastIndexOf(' ');
	// Back up to the last space unless that would throw away more than half the text.
	return { text: (space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd() + '…', truncated: true };
}
