import { env } from '$env/dynamic/private';
import { deriveKey } from './session';

export class ConfigError extends Error {}

export interface ServerConfig {
	gitlabUrl: string;
	group: string;
	labelFilter: string | undefined;
	cacheMs: number;
	oauth: { clientId: string; clientSecret: string } | null;
	/** Service token, only used for kiosk sessions */
	serviceToken: string | null;
	kioskKey: string | null;
	sessionKey: Buffer;
	flowKey: Buffer;
	/** Max time a user stays signed in before they must log in again, ms. Short: the token has `api` scope. */
	sessionMaxAgeMs: number;
	/** Schema (custom fields, statuses, projects…) cache per viewer, ms */
	schemaCacheMs: number;
	/** Closed items older than this are not fetched (the "completed issues" window cap) */
	closedDaysMax: number;
	/** 'group': one group workItems query. 'projects': one query per project (fallback, see README). */
	itemsMode: 'group' | 'projects';
	/** Config view ids a kiosk shows, in order */
	kioskViews: string[];
	/** Kiosk: switch to the next view every N seconds. 0 = stay on the first. */
	kioskRotateSeconds: number;
	/** Writes per session per minute */
	writeRatePerMinute: number;
}

let cached: ServerConfig | null = null;

/** Reads and validates env once. Throws ConfigError with a message meant for the operator. */
export function serverConfig(): ServerConfig {
	if (cached) return cached;

	const gitlabUrl = (env.GITLAB_URL?.trim() || 'https://gitlab.com').replace(/\/+$/, '');
	let parsed: URL;
	try {
		parsed = new URL(gitlabUrl);
	} catch {
		throw new ConfigError(`GITLAB_URL is not a valid URL: ${gitlabUrl}`);
	}
	const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
	if (parsed.protocol !== 'https:' && !isLocal) {
		throw new ConfigError('GITLAB_URL must use https:// so tokens are not sent in clear text.');
	}

	const group = env.GITLAB_GROUP?.trim();
	if (!group) throw new ConfigError('GITLAB_GROUP must be set.');

	const clientId = env.GITLAB_OAUTH_CLIENT_ID?.trim();
	const clientSecret = env.GITLAB_OAUTH_CLIENT_SECRET?.trim();
	if (!!clientId !== !!clientSecret) {
		throw new ConfigError('Set both GITLAB_OAUTH_CLIENT_ID and GITLAB_OAUTH_CLIENT_SECRET, or neither.');
	}
	const oauth = clientId && clientSecret ? { clientId, clientSecret } : null;

	const serviceToken = env.GITLAB_TOKEN?.trim() || null;
	const kioskKey = env.KIOSK_KEY?.trim() || null;
	if (kioskKey && kioskKey.length < 24) {
		throw new ConfigError('KIOSK_KEY must be at least 24 characters (try: openssl rand -base64 32).');
	}
	if (kioskKey && !serviceToken) {
		throw new ConfigError('KIOSK_KEY is set but GITLAB_TOKEN is not. Kiosk screens need the service token.');
	}
	if (!oauth && !kioskKey) {
		throw new ConfigError(
			'No way to sign in is configured. Set GITLAB_OAUTH_CLIENT_ID/SECRET for user login, and/or KIOSK_KEY + GITLAB_TOKEN for a kiosk screen.'
		);
	}

	const secret = env.SESSION_SECRET ?? '';
	if (secret.length < 32) {
		throw new ConfigError('SESSION_SECRET must be at least 32 characters (try: openssl rand -base64 48).');
	}

	const cacheSeconds = Number(env.CACHE_SECONDS ?? 30);
	// Every user session holds an `api`-scope token, so sessions are short by default.
	const sessionDays = Number(env.SESSION_MAX_AGE_DAYS ?? 1);
	const num = (raw: string | undefined, dflt: number, min = 0) => {
		const n = Number(raw ?? dflt);
		return Number.isFinite(n) && n >= min ? n : dflt;
	};
	const itemsMode = (env.GITLAB_ITEMS_MODE?.trim() || 'group').toLowerCase();
	if (itemsMode !== 'group' && itemsMode !== 'projects') {
		throw new ConfigError('GITLAB_ITEMS_MODE must be "group" or "projects".');
	}
	const kioskViews = (env.KIOSK_VIEWS ?? 'standup')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);

	cached = {
		gitlabUrl,
		group,
		labelFilter: env.GITLAB_LABEL_FILTER?.trim() || undefined,
		cacheMs: Number.isFinite(cacheSeconds) && cacheSeconds >= 0 ? cacheSeconds * 1000 : 30_000,
		oauth,
		serviceToken,
		kioskKey,
		sessionKey: deriveKey(secret, 'session-cookie-v1'),
		flowKey: deriveKey(secret, 'oauth-flow-cookie-v1'),
		sessionMaxAgeMs: (Number.isFinite(sessionDays) && sessionDays > 0 ? sessionDays : 1) * 86_400_000,
		schemaCacheMs: num(env.SCHEMA_CACHE_SECONDS, 600) * 1000,
		closedDaysMax: Math.min(365, num(env.CLOSED_DAYS_MAX, 30)),
		itemsMode: itemsMode as 'group' | 'projects',
		kioskViews: kioskViews.length ? kioskViews : ['standup'],
		kioskRotateSeconds: num(env.KIOSK_ROTATE_SECONDS, 0),
		writeRatePerMinute: Math.max(1, num(env.WRITE_RATE_PER_MINUTE, 60, 1))
	};
	return cached;
}
