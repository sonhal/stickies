import { json } from '@sveltejs/kit';
import { loadBoard } from '$lib/server/gitlab/load';
import type { RequestHandler } from './$types';

/**
 * GET → the viewer's board as JSON. The open page polls this instead of re-running the page load:
 * a failed fetch() is just skipped, whereas a failed SvelteKit navigation replaces the whole page
 * with the browser's error screen (and a wall screen never comes back from that).
 * Read-only, so the kiosk may call it too. hooks.server.ts answers 401 when there is no session.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const headers = { 'cache-control': 'private, no-store' };
	if (!locals.session) return json({ error: 'Not signed in' }, { status: 401, headers });
	return json({ board: await loadBoard(locals.session) }, { headers });
};
