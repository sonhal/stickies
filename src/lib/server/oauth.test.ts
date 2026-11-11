import { describe, expect, it } from 'vitest';
import { assertScope, KIOSK_SCOPES, OAuthError, SCOPES, scopeMatches } from './oauth';

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
