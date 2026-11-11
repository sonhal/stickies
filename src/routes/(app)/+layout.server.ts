import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { loadBoard } from '$lib/server/gitlab/load';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, setHeaders, url }) => {
	if (!locals.session) redirect(303, `/signin?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	// Issue data is private and per-user; never let a shared proxy cache it.
	setHeaders({ 'cache-control': 'private, no-store' });
	const cfg = serverConfig();
	const board = await loadBoard(locals.session);
	return {
		board,
		kiosk: locals.session.kind === 'kiosk' ? { views: cfg.kioskViews, rotateSeconds: cfg.kioskRotateSeconds } : null
	};
};
