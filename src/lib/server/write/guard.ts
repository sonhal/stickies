/**
 * Checks every write request must pass before any validation or GitLab call:
 *  - a signed-in user (the kiosk is always read-only)
 *  - same origin (CSRF): the Origin header must match the board's own origin. SvelteKit's
 *    built-in check only covers form content types; these endpoints take JSON, so check here too.
 *  - JSON body, size-limited
 *  - the per-session rate limit
 */
import type { Session } from '../session';
import { RateLimiter } from './ratelimit';

export const MAX_BODY_BYTES = 32_768;

export type GuardResult = { ok: true; body: unknown; userKey: string } | { ok: false; status: number; error: string };

export function originAllowed(origin: string | null, expected: string): boolean {
	return !!origin && origin === expected;
}

let limiter: RateLimiter | null = null;
export function writeLimiter(perMinute: number): RateLimiter {
	if (!limiter) limiter = new RateLimiter(perMinute);
	return limiter;
}
export function _resetLimiter() {
	limiter = null;
}

export async function guardWrite(
	request: Request,
	session: Session | null,
	expectedOrigin: string,
	rate: RateLimiter
): Promise<GuardResult> {
	if (!session) return { ok: false, status: 401, error: 'Not signed in' };
	if (session.kind !== 'user') return { ok: false, status: 403, error: 'The kiosk screen is read-only' };
	if (!originAllowed(request.headers.get('origin'), expectedOrigin)) {
		return { ok: false, status: 403, error: 'Cross-site request refused' };
	}
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return { ok: false, status: 415, error: 'Send JSON' };
	}
	const userKey = `user:${session.user.id}`;
	if (!rate.take(userKey)) {
		return { ok: false, status: 429, error: 'Too many changes in a short time. Wait a minute and try again.' };
	}
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'Request too large' };
	try {
		return { ok: true, body: JSON.parse(text), userKey };
	} catch {
		return { ok: false, status: 400, error: 'Invalid JSON' };
	}
}
