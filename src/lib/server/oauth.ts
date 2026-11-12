/**
 * GitLab OAuth 2.0: authorization code flow with PKCE, as a confidential client.
 * Docs: https://docs.gitlab.com/api/oauth2/
 *
 * The board then calls the GitLab API with the *user's* access token, so every
 * person sees exactly the issues their own GitLab permissions allow.
 */
import { createHash } from 'node:crypto';
import type { ServerConfig } from './config';
import type { UserSession } from './session';

/**
 * The board edits issues (status, custom fields, assignees, …) with the user's own token.
 * GitLab has no write scope limited to issues, so this has to be `api`. See README → Sign-in for
 * the mitigations (short sessions, sealed cookie, mutation allowlist, read-only kiosk).
 */
export const SCOPES = 'api';
/** The kiosk's service token must be read-only. */
export const KIOSK_SCOPES = 'read_api';

const TIMEOUT_MS = 10_000;

export class OAuthError extends Error {
	constructor(
		message: string,
		/** GitLab couldn't be reached or is having trouble: the token itself may still be fine */
		readonly transient = false
	) {
		super(message);
	}
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in?: number;
	created_at?: number;
	scope?: string;
}

export function authorizeUrl(
	cfg: ServerConfig,
	params: { redirectUri: string; state: string; challenge: string }
): string {
	const q = new URLSearchParams({
		client_id: cfg.oauth!.clientId,
		redirect_uri: params.redirectUri,
		response_type: 'code',
		scope: SCOPES,
		state: params.state,
		code_challenge: params.challenge,
		code_challenge_method: 'S256'
	});
	return `${cfg.gitlabUrl}/oauth/authorize?${q}`;
}

async function tokenRequest(cfg: ServerConfig, body: Record<string, string>): Promise<TokenResponse> {
	let res: Response;
	try {
		res = await fetch(`${cfg.gitlabUrl}/oauth/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
			body: new URLSearchParams({
				client_id: cfg.oauth!.clientId,
				client_secret: cfg.oauth!.clientSecret,
				...body
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (err) {
		throw new OAuthError(`Could not reach GitLab: ${(err as Error).message}`, true);
	}
	if (!res.ok) {
		// The body may contain error details; log the status only, never the request (it has the secret).
		throw new OAuthError(`GitLab token endpoint returned ${res.status}`, res.status >= 500 || res.status === 429);
	}
	let json: TokenResponse;
	try {
		json = (await res.json()) as TokenResponse;
	} catch {
		throw new OAuthError('GitLab token endpoint returned something that is not JSON', true);
	}
	if (!json.access_token || !json.refresh_token) throw new OAuthError('GitLab returned no token');
	assertScope(json.scope, SCOPES);
	return json;
}

/**
 * A token must carry exactly the expected scope: not a broader one (e.g. an app misconfigured with
 * `sudo` or `admin_mode` as well), and not a narrower one (a `read_api` token can't edit).
 * A response without a scope is refused too, since it can't be checked.
 */
export function scopeMatches(scope: string | undefined | null, expected: string): boolean {
	const got = (scope ?? '').split(/[\s,]+/).filter(Boolean);
	return got.length > 0 && got.every((s) => s === expected);
}

export function assertScope(scope: string | undefined | null, expected: string): void {
	if (!scopeMatches(scope, expected)) {
		throw new OAuthError(`Unexpected token scope "${scope ?? ''}". Give the GitLab application only ${expected}.`);
	}
}

// ---- Kiosk service token ------------------------------------------------------------------------

let serviceCheck: { at: number; ok: boolean; reason: string | null } | null = null;

/**
 * The kiosk is read-only by design: refuse a GITLAB_TOKEN that can write. Checked once an hour via
 * GET /personal_access_tokens/self (works for personal, project and group access tokens).
 * If GitLab can't tell us (old version, network), the kiosk still works and a warning is logged.
 */
export async function checkServiceToken(cfg: ServerConfig): Promise<{ ok: boolean; reason: string | null }> {
	if (serviceCheck && Date.now() - serviceCheck.at < 3_600_000) return serviceCheck;
	let result: { ok: boolean; reason: string | null } = { ok: true, reason: null };
	try {
		const res = await fetch(`${cfg.gitlabUrl}/api/v4/personal_access_tokens/self`, {
			headers: { 'PRIVATE-TOKEN': cfg.serviceToken ?? '', Accept: 'application/json' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (res.ok) {
			const body = (await res.json()) as { scopes?: string[] };
			if (!scopeMatches((body.scopes ?? []).join(' '), KIOSK_SCOPES)) {
				result = {
					ok: false,
					reason: `GITLAB_TOKEN has scopes "${(body.scopes ?? []).join(', ')}". The kiosk token must have only read_api.`
				};
			}
		} else {
			console.warn(`[kiosk] could not check GITLAB_TOKEN scopes (HTTP ${res.status}); make sure it is read_api only`);
		}
	} catch (err) {
		console.warn('[kiosk] could not check GITLAB_TOKEN scopes:', (err as Error).message);
		return result; // don't cache a network failure
	}
	serviceCheck = { at: Date.now(), ...result };
	return result;
}

function expiry(t: TokenResponse): number {
	// GitLab access tokens live 2 hours; fall back to that if expires_in is missing.
	const seconds = typeof t.expires_in === 'number' ? t.expires_in : 7200;
	const start = typeof t.created_at === 'number' ? t.created_at * 1000 : Date.now();
	return start + seconds * 1000;
}

export async function fetchCurrentUser(cfg: ServerConfig, accessToken: string) {
	const res = await fetch(`${cfg.gitlabUrl}/api/v4/user`, {
		headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new OAuthError(`Could not read the signed-in user (${res.status})`);
	const u = (await res.json()) as { id: number; username: string; name: string };
	return { id: u.id, username: u.username, name: u.name };
}

export async function exchangeCode(
	cfg: ServerConfig,
	params: { code: string; verifier: string; redirectUri: string }
): Promise<UserSession> {
	const t = await tokenRequest(cfg, {
		grant_type: 'authorization_code',
		code: params.code,
		code_verifier: params.verifier,
		redirect_uri: params.redirectUri
	});
	const user = await fetchCurrentUser(cfg, t.access_token);
	return {
		v: 1,
		kind: 'user',
		user,
		accessToken: t.access_token,
		refreshToken: t.refresh_token,
		expiresAt: expiry(t),
		issuedAt: Date.now()
	};
}

// GitLab rotates refresh tokens: each one works once. If two requests from the same browser
// race to refresh, the second would fail and log the user out. So concurrent refreshes of the
// same token share one request. (Single-process only; see README if you run several replicas.)
const refreshing = new Map<string, Promise<UserSession>>();

export function refreshSession(
	cfg: ServerConfig,
	session: UserSession,
	redirectUri: string
): Promise<UserSession> {
	const key = createHash('sha256').update(session.refreshToken).digest('hex');
	let p = refreshing.get(key);
	if (!p) {
		p = tokenRequest(cfg, {
			grant_type: 'refresh_token',
			refresh_token: session.refreshToken,
			redirect_uri: redirectUri
		})
			.then((t) => ({
				...session,
				accessToken: t.access_token,
				refreshToken: t.refresh_token,
				expiresAt: expiry(t)
			}))
			.then(
				(next) => {
					// Keep the result briefly so requests that arrive just after can reuse it.
					setTimeout(() => refreshing.delete(key), 30_000).unref?.();
					return next;
				},
				(err) => {
					// A failure isn't kept: the next request tries again (GitLab may just have been slow).
					refreshing.delete(key);
					throw err;
				}
			);
		refreshing.set(key, p);
	}
	return p;
}

/** Best effort: tell GitLab to invalidate the token on sign-out. */
export async function revokeToken(cfg: ServerConfig, token: string): Promise<void> {
	try {
		await fetch(`${cfg.gitlabUrl}/oauth/revoke`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: cfg.oauth!.clientId,
				client_secret: cfg.oauth!.clientSecret,
				token
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		/* the cookie is cleared regardless */
	}
}
