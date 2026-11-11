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

// ---- GITLAB_GROUP as a numeric id ----------------------------------------------------------------
// GraphQL's group(fullPath:) only takes a path, but GITLAB_GROUP may be a numeric id (review M6).
// The id is resolved once via REST (which accepts ids) and remembered. Only the id → path mapping
// is shared between viewers; every query still runs with the viewer's own token, so someone who
// can't see the group still gets "not found".

const resolvedGroupPaths = new Map<string, string>();

export function isNumericGroup(group: string): boolean {
	return /^\d+$/.test(group);
}

/** The group's full path for GraphQL. A path is returned as is. */
export async function groupPath(cfg: ServerConfig, cred: Credential): Promise<string> {
	if (!isNumericGroup(cfg.group)) return cfg.group;
	const known = resolvedGroupPaths.get(cfg.group);
	if (known) return known;
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (cred.kind === 'oauth') headers.Authorization = `Bearer ${cred.token}`;
	else headers['PRIVATE-TOKEN'] = cred.token;
	let res: Response;
	try {
		res = await fetch(`${cfg.gitlabUrl}/api/v4/groups/${cfg.group}?with_projects=false`, {
			headers,
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (err) {
		throw new GitLabError(`Could not reach GitLab (${err instanceof Error ? err.message : String(err)})`, 0);
	}
	if (res.status === 401) throw new GitLabError('GitLab rejected the token.', 401);
	if (res.status === 403 || res.status === 404) throw new GitLabError('Group not found, or you cannot see it. Check GITLAB_GROUP.', 404);
	if (!res.ok) throw new GitLabError('GitLab returned an error.', res.status);
	const body = (await res.json().catch(() => null)) as { full_path?: unknown } | null;
	const path = typeof body?.full_path === 'string' ? body.full_path : '';
	if (!/^[\w.-]+(\/[\w.-]+)*$/.test(path)) throw new GitLabError('GitLab returned an unexpected group path.', 502);
	resolvedGroupPaths.set(cfg.group, path);
	return path;
}

/** For display: the resolved path once known, else the configured value. */
export function groupLabelFor(cfg: ServerConfig): string {
	return resolvedGroupPaths.get(cfg.group) ?? cfg.group;
}

/** Test hook */
export function _resetGroupPaths() {
	resolvedGroupPaths.clear();
}
