import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * Old addresses of removed prioritization tools → their successor, keeping the query (?cycle, filters).
 * "standup" was the Eisenhower matrix; wall screens may still have /p/standup?cycle bookmarked.
 */
const MOVED: Record<string, string> = { standup: 'priority-effort' };

export const load: PageLoad = ({ params, url }) => {
	const to = MOVED[params.toolId];
	if (to) redirect(308, `/p/${to}${url.search}`);
};
