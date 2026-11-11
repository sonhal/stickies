import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { redirectUri, takeFlow, writeSession } from '$lib/server/auth';
import { exchangeCode, OAuthError } from '$lib/server/oauth';
import { safeEqual } from '$lib/server/session';
import type { RequestHandler } from './$types';

// Only short codes go in the URL; the sign-in page maps them to fixed messages, so nobody can
// craft a link that makes the board display text of their choosing.
const fail = (code: 'disabled' | 'denied' | 'expired' | 'nocode' | 'failed' | 'scope') =>
	redirect(303, `/signin?error=${code}`);

export const GET: RequestHandler = async ({ url, cookies }) => {
	const cfg = serverConfig();
	if (!cfg.oauth) fail('disabled');

	const flow = takeFlow(cookies, cfg);
	const state = url.searchParams.get('state');
	const code = url.searchParams.get('code');

	if (url.searchParams.get('error')) fail('denied');
	// state ties this callback to the browser that started the login (CSRF protection).
	if (!flow || !state || !safeEqual(state, flow.state)) fail('expired');
	if (!code) fail('nocode');

	let session;
	try {
		session = await exchangeCode(cfg, {
			code: code!,
			verifier: flow!.verifier,
			redirectUri: redirectUri(url.origin)
		});
	} catch (err) {
		const msg = (err as Error).message;
		console.warn('[auth] code exchange failed:', msg);
		fail(err instanceof OAuthError && msg.startsWith('Unexpected token scope') ? 'scope' : 'failed');
	}

	writeSession(cookies, cfg, session!);
	redirect(303, flow!.returnTo);
};
