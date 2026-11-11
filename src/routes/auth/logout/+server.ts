import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { clearSession, readSession } from '$lib/server/auth';
import { revokeToken } from '$lib/server/oauth';
import { forgetViewer } from '$lib/server/gitlab/load';
import { viewerKey } from '$lib/server/gitlab/client';
import type { RequestHandler } from './$types';

// POST only: SvelteKit's built-in origin check on form posts stops other sites from logging people out.
export const POST: RequestHandler = async ({ cookies }) => {
	const cfg = serverConfig();
	const session = readSession(cookies, cfg);
	clearSession(cookies);
	if (session?.kind === 'user') forgetViewer(viewerKey(session));
	if (session?.kind === 'user' && cfg.oauth) {
		await Promise.all([revokeToken(cfg, session.accessToken), revokeToken(cfg, session.refreshToken)]);
	}
	redirect(303, '/signin?signedOut=1');
};
