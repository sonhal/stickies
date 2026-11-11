import { error, redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { redirectUri, writeFlow } from '$lib/server/auth';
import { authorizeUrl } from '$lib/server/oauth';
import { pkceChallenge, randomToken, safeReturnTo } from '$lib/server/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
	const cfg = serverConfig();
	if (!cfg.oauth) error(404, 'GitLab sign-in is not enabled on this board.');

	const state = randomToken();
	const verifier = randomToken(48); // 64 chars, within PKCE's 43-128
	writeFlow(cookies, cfg, {
		state,
		verifier,
		returnTo: safeReturnTo(url.searchParams.get('returnTo')),
		expiresAt: Date.now() + 10 * 60_000
	});

	redirect(
		303,
		authorizeUrl(cfg, { redirectUri: redirectUri(url.origin), state, challenge: pkceChallenge(verifier) })
	);
};
