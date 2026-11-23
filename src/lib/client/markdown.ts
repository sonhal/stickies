/**
 * GitLab-style Markdown → safe HTML, for comments and descriptions (through Markdown.svelte).
 * Browser only (DOMPurify needs the DOM).
 *
 * The text is written by anyone who can comment on or edit an item in GitLab, so it is untrusted. Two layers:
 *  1. `marked` turns Markdown into HTML (GFM: tables, task lists, strikethrough; single newlines
 *     become line breaks, as people expect in a comment box). Raw HTML in the text is allowed
 *     through to step 2, which decides what survives.
 *  2. DOMPurify keeps only an allowlist of formatting tags and attributes. No images, media,
 *     iframes, forms, styles or event handlers; links only to http(s) and mailto. Every link opens
 *     in a new tab with rel="noopener noreferrer nofollow".
 * The page's Content-Security-Policy (script-src 'self', img-src 'self' data:) is a third layer.
 *
 * Images are shown as links (GitLab uploads need a GitLab session and the CSP blocks remote images).
 * Relative links (GitLab uploads, `/group/project/-/issues/1`) are resolved against the item's
 * GitLab address, so they point at GitLab, not at the board.
 *
 * Not rendered like GitLab: references (#12, @name, ~label) stay plain text, and there's no
 * Mermaid, math or emoji shortcodes.
 */
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
	'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote', 'kbd', 'sub', 'sup',
	'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'input', 'details', 'summary', 'span'
];
const ALLOWED_ATTR = ['href', 'title', 'type', 'checked', 'disabled', 'align', 'start'];
const SAFE_URL = /^(?:https?:|mailto:)/i;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		image({ href, title, text }) {
			return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>🖼 ${escapeHtml(text || 'image')}</a>`;
		}
	}
});

/**
 * The GitLab address relative links resolve against: a project's (or group's) address for an
 * uploads path, the GitLab origin for an absolute path. From the item's web URL, e.g.
 * https://gitlab.example.com/acme/api/-/issues/12 → https://gitlab.example.com/acme/api
 */
export function linkBase(itemUrl: string | null): { origin: string; project: string } | null {
	if (!itemUrl) return null;
	try {
		const u = new URL(itemUrl);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
		const path = u.pathname.split('/-/')[0].replace(/\/+$/, '');
		return { origin: u.origin, project: u.origin + path };
	} catch {
		return null;
	}
}

function resolveHref(href: string, base: { origin: string; project: string } | null): string | null {
	const h = href.trim();
	if (!h) return null;
	if (SAFE_URL.test(h)) return h;
	if (!base || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null; // other schemes, protocol-relative
	try {
		if (h.startsWith('/uploads/')) return new URL(base.project + h).href;
		if (h.startsWith('/')) return new URL(base.origin + h).href;
		return new URL(h, base.project + '/').href;
	} catch {
		return null;
	}
}

/** Sanitized HTML for a comment body or description. Only ever pass the result to {@html}. */
export function renderMarkdown(text: string, itemUrl: string | null): string {
	if (typeof window === 'undefined') return escapeHtml(text);
	const base = linkBase(itemUrl);
	const raw = marked.parse(text, { async: false }) as string;
	const purify = DOMPurify(window);
	purify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') {
			// DOMPurify already removed an unsafe href (javascript:, data: …); never invent one
			const raw = node.getAttribute('href');
			const href = raw ? resolveHref(raw, base) : null;
			if (href) node.setAttribute('href', href);
			else node.removeAttribute('href');
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer nofollow');
		} else if (node.tagName === 'INPUT') {
			// Only GFM task list checkboxes, never editable
			if (node.getAttribute('type') !== 'checkbox') node.remove();
			else node.setAttribute('disabled', '');
		}
	});
	return purify.sanitize(raw, {
		ALLOWED_TAGS,
		ALLOWED_ATTR: [...ALLOWED_ATTR, 'target', 'rel'],
		ALLOW_DATA_ATTR: false,
		ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/|#|[^:]*$)/i
	});
}
