import { describe, expect, it } from 'vitest';
import { deriveKey, pkceChallenge, safeEqual, safeReturnTo, seal, unseal } from './session';

const key = deriveKey('x'.repeat(40), 'session-cookie-v1');

describe('sealed cookies', () => {
	it('round-trips', () => {
		const v = { kind: 'user', accessToken: 'abc' };
		expect(unseal(seal(v, key), key)).toEqual(v);
	});

	it('does not contain the plaintext', () => {
		expect(seal({ accessToken: 'glpat-secret' }, key).includes('secret')).toBe(false);
	});

	it('rejects tampering, wrong keys and junk', () => {
		const sealed = seal({ a: 1 }, key);
		const bytes = Buffer.from(sealed, 'base64url');
		bytes[bytes.length - 1] ^= 1;
		expect(unseal(bytes.toString('base64url'), key)).toBeNull();
		expect(unseal(sealed, deriveKey('x'.repeat(40), 'other-purpose'))).toBeNull();
		expect(unseal('not-a-cookie', key)).toBeNull();
		expect(unseal(undefined, key)).toBeNull();
	});
});

describe('PKCE', () => {
	it('matches the RFC 7636 test vector', () => {
		expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});
});

describe('safeEqual', () => {
	it('compares strings', () => {
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
	});
});

describe('safeReturnTo', () => {
	it('keeps local paths', () => {
		expect(safeReturnTo('/?view=list')).toBe('/?view=list');
	});
	it('blocks open redirects', () => {
		for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'evil', '/x\r\nSet-Cookie: a', null]) {
			expect(safeReturnTo(bad)).toBe('/');
		}
	});
});
