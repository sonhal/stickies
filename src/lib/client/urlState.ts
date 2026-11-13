/**
 * Links into the board.
 *
 * - `/issue/<id>`: an issue's (or epic's) full page. The id is the number at the end of the GitLab
 *   global id (gid://gitlab/WorkItem/123 → 123), like `/epics/<id>`. A full reference
 *   (`my-team/api#12`, or `my-group&3` for an epic) is accepted too, for hand-written links.
 * - `?sidebar=hidden`: opens with the sidebar hidden, e.g. on a kiosk screen. Optional: without it
 *   the sidebar is as you left it. It isn't saved as your preference, and it stays in the URL
 *   (so a reload keeps it) until you show the sidebar yourself.
 *
 * The side panel is deliberately not in the URL: it's a quick look. Links go to the full page.
 */
import type { WorkItem } from '$lib/fields/types';

export const SIDEBAR_PARAM = 'sidebar';

/** The short id used in links: the number after the last `/` of the global id. */
export function itemParam(id: string): string {
	return id.slice(id.lastIndexOf('/') + 1);
}

/** Path of an item's full page. */
export function issuePath(id: string): string {
	return `/issue/${encodeURIComponent(itemParam(id))}`;
}

/** Finds the item a link names (short id, full global id, or reference). */
export function findItemByParam(items: readonly WorkItem[], value: string | null | undefined): WorkItem | null {
	const v = value?.trim();
	if (!v || v.length > 300) return null;
	if (/[#&]/.test(v)) {
		const ref = v.toLowerCase();
		return items.find((i) => i.ref.toLowerCase() === ref) ?? null;
	}
	return items.find((i) => i.id === v || itemParam(i.id) === v) ?? null;
}

/** True when the URL asks for the sidebar to be hidden (`?sidebar=hidden`). */
export function readSidebarParam(params: URLSearchParams): boolean {
	return params.get(SIDEBAR_PARAM) === 'hidden';
}

/**
 * The URL with `?sidebar=hidden` added or removed, or null when the URL already says that.
 * Other parameters are left alone, in their order.
 */
export function withSidebarParam(url: URL, hidden: boolean): URL | null {
	const next = new URL(url);
	if (hidden) next.searchParams.set(SIDEBAR_PARAM, 'hidden');
	else next.searchParams.delete(SIDEBAR_PARAM);
	return next.search === url.search ? null : next;
}

/**
 * For links and pages that build their own query string (share links, the epics list): adds
 * `?sidebar=hidden` back when the current URL has it.
 */
export function keepShellParams(qs: string, current: URLSearchParams): string {
	const p = new URLSearchParams(qs);
	if (readSidebarParam(current) && !p.has(SIDEBAR_PARAM)) p.set(SIDEBAR_PARAM, 'hidden');
	return p.toString();
}
