import type { Cookies } from '@sveltejs/kit';
import type { ServerConfig } from './config';
import { seal, unseal, type OAuthFlow, type Session } from './session';

export const SESSION_COOKIE = 'board_session';
export const FLOW_COOKIE = 'board_oauth';
const KIOSK_MAX_AGE_S = 30 * 86_400;

const base = { path: '/', httpOnly: true, sameSite: 'lax' as const };
// `secure` is left to SvelteKit's default: on everywhere except http://localhost in dev.

export function readSession(cookies: Cookies, cfg: ServerConfig): Session | null {
	const s = unseal<Session>(cookies.get(SESSION_COOKIE), cfg.sessionKey);
	if (!s || s.v !== 1) return null;
	const maxAge = s.kind === 'kiosk' ? KIOSK_MAX_AGE_S * 1000 : cfg.sessionMaxAgeMs;
	if (Date.now() - s.issuedAt > maxAge) return null;
	// A kiosk cookie is useless once kiosk mode is turned off.
	if (s.kind === 'kiosk' && (!cfg.kioskKey || !cfg.serviceToken)) return null;
	if (s.kind === 'user' && !cfg.oauth) return null;
	return s;
}

export function writeSession(cookies: Cookies, cfg: ServerConfig, s: Session) {
	const maxAgeMs = s.kind === 'kiosk' ? KIOSK_MAX_AGE_S * 1000 : cfg.sessionMaxAgeMs;
	const remaining = Math.max(60, Math.floor((s.issuedAt + maxAgeMs - Date.now()) / 1000));
	cookies.set(SESSION_COOKIE, seal(s, cfg.sessionKey), { ...base, maxAge: remaining });
}

export function clearSession(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function writeFlow(cookies: Cookies, cfg: ServerConfig, flow: OAuthFlow) {
	cookies.set(FLOW_COOKIE, seal(flow, cfg.flowKey), { ...base, path: '/auth', maxAge: 600 });
}

/** Read and immediately delete: a flow cookie is single-use. */
export function takeFlow(cookies: Cookies, cfg: ServerConfig): OAuthFlow | null {
	const flow = unseal<OAuthFlow>(cookies.get(FLOW_COOKIE), cfg.flowKey);
	cookies.delete(FLOW_COOKIE, { path: '/auth' });
	if (!flow || flow.expiresAt < Date.now()) return null;
	return flow;
}

export function redirectUri(origin: string): string {
	return `${origin}/auth/callback`;
}
