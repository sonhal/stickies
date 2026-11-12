import type { Handle } from '@sveltejs/kit';
import { ConfigError, serverConfig } from '$lib/server/config';
import { clearSession, readSession, redirectUri, writeSession } from '$lib/server/auth';
import { OAuthError, refreshSession } from '$lib/server/oauth';

/** Paths reachable without a session. */
const PUBLIC = ['/signin', '/auth/', '/kiosk/', '/favicon.svg'];
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(p));

/** Refresh the access token this long before it actually expires. */
const REFRESH_EARLY_MS = 60_000;

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.session = null;

	let cfg;
	try {
		cfg = serverConfig();
	} catch (err) {
		if (err instanceof ConfigError) {
			// Shown to whoever opens the board; contains no secrets, only what to fix.
			return new Response(`Board is not configured: ${err.message}\n`, {
				status: 500,
				headers: { 'content-type': 'text/plain; charset=utf-8' }
			});
		}
		throw err;
	}

	let session = readSession(event.cookies, cfg);

	if (session?.kind === 'user' && session.expiresAt - Date.now() < REFRESH_EARLY_MS) {
		try {
			session = await refreshSession(cfg, session, redirectUri(event.url.origin));
			writeSession(event.cookies, cfg, session);
		} catch (err) {
			if (err instanceof OAuthError && err.transient) {
				// GitLab was unreachable or erroring, which says nothing about the token: keep the session
				// and try again on the next request. If the access token has run out meanwhile, the board
				// shows GitLab's own "sign in again" until a refresh succeeds.
				console.warn('[auth] refresh postponed:', err.message);
			} else {
				// Refresh token revoked/expired, or the user lost access: sign them out cleanly.
				console.warn('[auth] refresh failed:', (err as Error).message);
				clearSession(event.cookies);
				session = null;
			}
		}
	}

	event.locals.session = session;

	if (!session && !isPublic(event.url.pathname)) {
		// Client-side data requests (e.g. the auto-refresh in an expired tab) are let through:
		// the root +layout.server.ts throws a redirect, which SvelteKit turns into a client navigation.
		if (event.isDataRequest) return resolve(event);
		// API routes answer 401 instead: a redirect would hand the sign-in page's HTML to a fetch().
		if (event.request.method === 'GET' && !event.url.pathname.startsWith('/api/')) {
			const back = event.url.pathname + event.url.search;
			return new Response(null, {
				status: 303,
				headers: { location: `/signin?returnTo=${encodeURIComponent(back)}` }
			});
		}
		return new Response('Not signed in', { status: 401 });
	}

	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	return response;
};
