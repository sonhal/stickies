/**
 * Encrypted, tamper-proof cookie payloads (AES-256-GCM).
 *
 * The session cookie holds the user's GitLab access + refresh token, so it must be
 * unreadable to the browser and to anyone who copies it out of logs: GCM gives us both
 * confidentiality and integrity (a modified cookie fails authentication and is discarded).
 *
 * This file is pure (no $env imports) so it can be unit tested.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Derive a purpose-bound 256-bit key, so the same secret never encrypts two kinds of data. */
export function deriveKey(secret: string, purpose: string): Buffer {
	return Buffer.from(hkdfSync('sha256', secret, 'eisenhower-board', purpose, 32));
}

export function seal(payload: unknown, key: Buffer): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal<T>(value: string | undefined, key: Buffer): T | null {
	if (!value) return null;
	try {
		const raw = Buffer.from(value, 'base64url');
		if (raw.length <= IV_BYTES + TAG_BYTES) return null;
		const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
		decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
		const json = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
		return JSON.parse(json.toString('utf8')) as T;
	} catch {
		// Wrong key, truncated, or tampered: treat as "no session".
		return null;
	}
}

// ---- PKCE (RFC 7636) ----------------------------------------------------------

export function randomToken(bytes = 32): string {
	return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
	return createHash('sha256').update(verifier).digest('base64url');
}

/** Constant-time string compare (hash first so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
	const ha = createHash('sha256').update(a).digest();
	const hb = createHash('sha256').update(b).digest();
	return timingSafeEqual(ha, hb);
}

/**
 * Only allow redirects back to a path on this site. Blocks open redirects like
 * `//evil.example`, `/\evil.example`, or absolute URLs smuggled into `returnTo`.
 */
export function safeReturnTo(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
	if (/[\r\n\t]/.test(value)) return '/';
	return value;
}

// ---- Session shapes -------------------------------------------------------------

export interface UserSession {
	v: 1;
	kind: 'user';
	user: { id: number; username: string; name: string };
	accessToken: string;
	refreshToken: string;
	/** Access token expiry, epoch ms */
	expiresAt: number;
	/** When the user signed in, epoch ms. Caps how long refresh can keep a session alive. */
	issuedAt: number;
}

export interface KioskSession {
	v: 1;
	kind: 'kiosk';
	issuedAt: number;
}

export type Session = UserSession | KioskSession;

export interface OAuthFlow {
	state: string;
	verifier: string;
	returnTo: string;
	expiresAt: number;
}
