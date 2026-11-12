import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertScope, KIOSK_SCOPES, OAuthError, refreshSession, SCOPES, scopeMatches } from './oauth';
import type { ServerConfig } from './config';
import type { UserSession } from './session';

describe('token scope check', () => {
	it('asks users for exactly api and the kiosk for read_api', () => {
		expect(SCOPES).toBe('api');
		expect(KIOSK_SCOPES).toBe('read_api');
	});

	it('accepts a token whose scope is exactly api', () => {
		expect(scopeMatches('api', 'api')).toBe(true);
		expect(() => assertScope('api', SCOPES)).not.toThrow();
	});

	it('rejects a sign-in token whose scope is not exactly api', () => {
		for (const bad of ['read_api', 'api sudo', 'api read_user', 'read_api api', 'admin_mode', '', null, undefined]) {
			expect(scopeMatches(bad, 'api')).toBe(false);
			expect(() => assertScope(bad, SCOPES)).toThrow(OAuthError);
		}
	});

	it('rejects a kiosk token that can write', () => {
		expect(scopeMatches('read_api', KIOSK_SCOPES)).toBe(true);
		expect(scopeMatches('api', KIOSK_SCOPES)).toBe(false);
		expect(scopeMatches('read_api,write_repository', KIOSK_SCOPES)).toBe(false);
	});
});

describe('token refresh', () => {
	const cfg = { gitlabUrl: 'https://gitlab.example.com', oauth: { clientId: 'c', clientSecret: 's' } } as ServerConfig;
	const session = (refreshToken: string) =>
		({ v: 1, kind: 'user', user: { id: 1, username: 'a', name: 'A' }, accessToken: 'old', refreshToken, expiresAt: 0, issuedAt: 0 }) as UserSession;
	const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
	afterEach(() => vi.unstubAllGlobals());

	it('marks an unreachable or erroring GitLab as transient, so the session is kept', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('timeout'))));
		await expect(refreshSession(cfg, session('r1'), 'https://b/auth/callback')).rejects.toMatchObject({ transient: true });
		vi.stubGlobal('fetch', reply(503, {}));
		await expect(refreshSession(cfg, session('r1'), 'https://b/auth/callback')).rejects.toMatchObject({ transient: true });
	});

	it('marks a refused refresh token as final', async () => {
		vi.stubGlobal('fetch', reply(400, { error: 'invalid_grant' }));
		await expect(refreshSession(cfg, session('r2'), 'https://b/auth/callback')).rejects.toMatchObject({ transient: false });
	});

	it('retries after a failure instead of replaying it', async () => {
		vi.stubGlobal('fetch', reply(502, {}));
		await expect(refreshSession(cfg, session('r3'), 'https://b/auth/callback')).rejects.toBeInstanceOf(OAuthError);
		vi.stubGlobal('fetch', reply(200, { access_token: 'new', refresh_token: 'r4', expires_in: 7200, scope: 'api' }));
		expect((await refreshSession(cfg, session('r3'), 'https://b/auth/callback')).accessToken).toBe('new');
	});
});
