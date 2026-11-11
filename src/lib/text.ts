/**
 * Turn a GitLab Markdown description into readable plain text for the standup screen.
 *
 * Deliberately not a Markdown renderer: output is shown with Svelte's normal text
 * escaping, so there is no HTML injection surface at all. It keeps the words, line
 * breaks, list bullets and checkboxes, and drops syntax noise.
 */
export function markdownToText(md: string | null | undefined): string {
	if (!md) return '';
	let s = md.replace(/\r\n?/g, '\n');

	s = s.replace(/<!--[\s\S]*?-->/g, ''); // HTML comments (issue templates are full of them)
	s = s.replace(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm, '$1'); // fenced code: keep the code
	s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `[image: ${alt}]` : '[image]'));
	s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links: keep the text
	s = s.replace(/<\/?[a-z][^>]*>/gi, ''); // inline HTML tags (e.g. <details>, <br>)
	s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ''); // heading markers
	s = s.replace(/^[ \t]{0,3}>[ \t]?/gm, ''); // blockquote markers
	s = s.replace(/^([ \t]*)[-*+][ \t]+\[[xX]\][ \t]+/gm, '$1☑ '); // done task
	s = s.replace(/^([ \t]*)[-*+][ \t]+\[ \][ \t]+/gm, '$1☐ '); // open task
	s = s.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• '); // bullets
	s = s.replace(/(\*\*|__)(.+?)\1/g, '$2'); // bold
	s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/gm, '$1$2'); // italic
	s = s.replace(/~~(.+?)~~/g, '$1'); // strikethrough
	s = s.replace(/`([^`\n]+)`/g, '$1'); // inline code
	s = s.replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, ''); // horizontal rules
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
