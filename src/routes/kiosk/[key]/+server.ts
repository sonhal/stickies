import { error, redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { writeSession } from '$lib/server/auth';
import { safeEqual } from '$lib/server/session';
import type { RequestHandler } from './$types';

/**
 * Open /kiosk/<KIOSK_KEY> once on the wall screen. It stores a 30-day kiosk cookie and
 * redirects to the board, so the key doesn't stay in the address bar.
 * The kiosk sees what GITLAB_TOKEN can see, so scope that token to the group only.
 */
export const GET: RequestHandler = ({ params, cookies }) => {
	const cfg = serverConfig();
	if (!cfg.kioskKey || !cfg.serviceToken || !safeEqual(params.key, cfg.kioskKey)) {
		error(404, 'Not found');
	}
	writeSession(cookies, cfg, { v: 1, kind: 'kiosk', issuedAt: Date.now() });
	redirect(303, '/');
};
