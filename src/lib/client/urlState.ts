/**
 * Shell state that lives in the URL, so a link can open the board the way it looked:
 *
 * - `?issue=<id>`: the detail panel is open on this item. The id is the number at the end of the
 *   GitLab global id (gid://gitlab/WorkItem/123 → 123), like `/epics/<id>`. A full reference
 *   (`my-team/api#12`, or `my-group&3` for an epic) is accepted too, for hand-written links.
 * - `?sidebar=hidden`: opens with the sidebar hidden, e.g. on a kiosk screen. Optional: without it
 *   the sidebar is as you left it. It isn't saved as your preference, and it stays in the URL
 *   (so a reload keeps it) until you show the sidebar yourself.
 *
 * These ride along with whatever else a page keeps in its query string (`?v=` on views, the
 * epics list state), so pages that rewrite their query keep them with `keepShellParams`.
 */
import type { WorkItem } from '$lib/fields/types';

export const ISSUE_PARAM = 'issue';
export const SIDEBAR_PARAM = 'sidebar';
const SHELL_PARAMS = [ISSUE_PARAM, SIDEBAR_PARAM] as const;

export interface ShellState {
	/** Global id of the item open in the panel, or null */
	issue: string | null;
	/** Keep `?sidebar=hidden` in the URL (only while it came from the URL and still applies) */
	sidebarHidden: boolean;
}

/** The short id used in links: the number after the last `/` of the global id. */
export function itemParam(id: string): string {
	return id.slice(id.lastIndexOf('/') + 1);
}

/** Finds the item a `?issue=` value names (short id, full global id, or reference). */
export function findItemByParam(items: readonly WorkItem[], value: string | null): WorkItem | null {
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
 * The URL with the shell state written into it, or null when the URL already says that.
 * Other parameters are left alone, in their order.
 */
export function withShellState(url: URL, s: ShellState): URL | null {
	const next = new URL(url);
	const p = next.searchParams;
	const issue = s.issue ? itemParam(s.issue) : null;
	if (issue) p.set(ISSUE_PARAM, issue);
	else p.delete(ISSUE_PARAM);
	if (s.sidebarHidden) p.set(SIDEBAR_PARAM, 'hidden');
	else p.delete(SIDEBAR_PARAM);
	return next.search === url.search ? null : next;
}

/**
 * For pages that build their own query string (the epics list): adds back the shell parameters
 * from the current URL, so writing the page's state doesn't close the panel or the sidebar.
 */
export function keepShellParams(qs: string, current: URLSearchParams): string {
	const p = new URLSearchParams(qs);
	for (const name of SHELL_PARAMS) {
		const v = current.get(name);
		if (v !== null && !p.has(name)) p.set(name, v);
	}
	return p.toString();
}
