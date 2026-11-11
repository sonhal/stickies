import type { ServerConfig } from '../config';
import type { Session } from '../session';

export class GitLabError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

/**
 * The OAuth access token is sent as a Bearer token; the kiosk's service token goes in PRIVATE-TOKEN.
 * GitLab accepts either way, but this keeps the two easy to tell apart in logs.
 */
export type Credential = { kind: 'oauth'; token: string } | { kind: 'service'; token: string };

export function credentialFor(session: Session, cfg: ServerConfig): Credential {
	return session.kind === 'user'
		? { kind: 'oauth', token: session.accessToken }
		: { kind: 'service', token: cfg.serviceToken ?? '' };
}

/** Cache key: one entry per user; all kiosk screens share one. */
export function viewerKey(session: Session): string {
	return session.kind === 'user' ? `user:${session.user.id}` : 'kiosk';
}

const REQUEST_TIMEOUT_MS = 20_000;

export interface GqlResponse<T> {
	data: T;
	/** Partial errors (data still returned), e.g. a Premium-only part on Free. Logged, not shown. */
	errors: string[];
}

export async function graphql<T>(
	cfg: ServerConfig,
	cred: Credential,
	query: string,
	variables: Record<string, unknown> = {}
): Promise<GqlResponse<T>> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
	if (cred.kind === 'oauth') headers.Authorization = `Bearer ${cred.token}`;
	else headers['PRIVATE-TOKEN'] = cred.token;

	let res: Response;
	try {
		res = await fetch(`${cfg.gitlabUrl}/api/graphql`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		throw new GitLabError(`Could not reach GitLab (${reason})`, 0);
	}

	if (!res.ok) {
		// Don't echo GitLab's response body: the status code is enough to diagnose.
		const hint =
			res.status === 401
				? 'GitLab rejected the token.'
				: res.status === 403
					? 'You do not have access to this group in GitLab.'
					: res.status === 429
						? 'GitLab is rate limiting the board. Raise CACHE_SECONDS.'
						: 'GitLab returned an error.';
		throw new GitLabError(hint, res.status);
	}

	let body: { data?: T | null; errors?: { message?: string }[] };
	try {
		body = await res.json();
	} catch {
		throw new GitLabError('GitLab returned something that is not JSON.', 502);
	}
	const errors = (body.errors ?? []).map((e) => String(e?.message ?? 'error').slice(0, 300));
	if (!body.data) {
		// Usually a schema mismatch (a field this GitLab doesn't have). The operator needs the
		// message; it goes to the log and the UI gets a fixed text.
		console.error('[gitlab] GraphQL errors:', errors.join(' | '));
		const auth = errors.some((e) => /permission|not authorized|access/i.test(e));
		throw new GitLabError(
			auth
				? 'GitLab refused the request (permissions).'
				: 'GitLab rejected the board\'s query. Run scripts/introspect.ts and see the server log.',
			auth ? 403 : 422
		);
	}
	if (errors.length) console.warn('[gitlab] partial GraphQL errors:', errors.join(' | '));
	return { data: body.data, errors };
}
