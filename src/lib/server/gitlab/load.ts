/**
 * Loads the board for one viewer, with their own token, and caches it per viewer.
 *
 * - Capabilities (which optional GraphQL types exist): instance-wide, not viewer data, 1 h.
 * - Schema → FieldRegistry: per viewer, SCHEMA_CACHE_SECONDS (default 10 min).
 * - Items: per viewer, CACHE_SECONDS (default 30 s). Writes update the entry in place.
 *
 * Two people can see different items and fields, so one viewer's data is never served to another.
 */
import { withEpics } from '$lib/fields/epic';
import type { BoardData, FieldRegistry, LoadProblem, WorkItem } from '$lib/fields/types';
import { ConfigError, serverConfig, type ServerConfig } from '../config';
import { checkServiceToken } from '../oauth';
import type { Session } from '../session';
import { credentialFor, GitLabError, graphql, groupLabelFor, groupPath, viewerKey, type Credential } from './client';
import {
	emptySeen,
	mergeSeen,
	normalizeSchema,
	normalizeWorkItem,
	type RawSchema,
	type Conn,
	type RawWorkItem,
	type Seen
} from './normalize';
import {
	ALL_CAPABILITIES,
	CAPABILITIES,
	groupWorkItemsQuery,
	parseCapabilities,
	projectWorkItemsQuery,
	SCHEMA_LIST_MAX,
	SCHEMA_LISTS,
	schemaPageQuery,
	schemaQuery,
	type Capabilities
} from './queries';

/** GitLab's largest page. Measured on gitlab.com: query complexity 82 of 250, about 3 s a page. */
const PAGE_SIZE = 100;
const CAPS_MS = 3_600_000;
const MAX_ENTRIES = 200;

// ---- Capabilities --------------------------------------------------------------------------------

let caps: { at: number; value: Capabilities } | null = null;

export async function capabilities(cfg: ServerConfig, cred: Credential): Promise<Capabilities> {
	if (caps && Date.now() - caps.at < CAPS_MS) return caps.value;
	try {
		const { data } = await graphql<unknown>(cfg, cred, CAPABILITIES);
		caps = { at: Date.now(), value: parseCapabilities(data) };
	} catch (err) {
		// Only "GitLab refused the probe itself" (introspection switched off) is handled here: the
		// board targets GitLab 18.x, so assume everything exists rather than not loading at all.
		// Network, token and rate-limit errors are the caller's to report.
		if (!(err instanceof GitLabError) || (err.status !== 422 && err.status !== 403)) throw err;
		console.warn('[gitlab] capability probe refused; assuming a current GitLab with every optional part');
		caps = { at: Date.now(), value: ALL_CAPABILITIES };
	}
	return caps.value;
}

// ---- Per-viewer caches ------------------------------------------------------------------------

interface SchemaEntry {
	at: number;
	registry: FieldRegistry;
}
interface ItemsEntry {
	at: number;
	items: WorkItem[];
	seen: Seen;
	/** Shown on the board, e.g. "only the 5000 most recently updated open items were loaded" */
	warnings: string[];
}

const schemaCache = new Map<string, SchemaEntry>();
const itemsCache = new Map<string, ItemsEntry>();
const inFlight = new Map<string, Promise<{ schema: SchemaEntry; items: ItemsEntry }>>();

function remember<T>(map: Map<string, T>, key: string, entry: T) {
	map.delete(key); // re-insert so Map order = least recently used first
	map.set(key, entry);
	while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
}

/** Drop everything cached for a viewer (sign-out, revoked token). */
export function forgetViewer(key: string) {
	schemaCache.delete(key);
	itemsCache.delete(key);
}

/**
 * Follow a connection's cursor until it ends or `max` nodes are loaded (review M7).
 * Returns every node, and whether the list was cut at `max`.
 */
export async function collectPages<T>(
	first: Conn<T> | null | undefined,
	nextPage: (after: string) => Promise<Conn<T> | null | undefined>,
	max: number
): Promise<{ nodes: (T | null)[]; capped: boolean }> {
	const nodes: (T | null)[] = [...(first?.nodes ?? [])];
	let info = first?.pageInfo;
	let pages = 1;
	while (info?.hasNextPage && info.endCursor && nodes.length < max) {
		const page = await nextPage(info.endCursor);
		nodes.push(...(page?.nodes ?? []));
		info = page?.pageInfo;
		if (++pages > 200) break; // a cursor that never ends must not loop forever
	}
	const capped = nodes.length > max || (!!info?.hasNextPage && nodes.length >= max);
	return { nodes: nodes.slice(0, max), capped };
}

async function fetchSchema(cfg: ServerConfig, cred: Credential, c: Capabilities): Promise<FieldRegistry> {
	const { data, errors } = await graphql<RawSchema>(cfg, cred, schemaQuery(c), { fullPath: cfg.group });
	if (!data.group) throw new GitLabError('Group not found, or you cannot see it. Check GITLAB_GROUP.', 404);
	// Lists longer than one page: fetch the rest, so nothing past the first 100 is silently missing
	const capped: string[] = [];
	const group = data.group as Record<string, unknown>;
	for (const list of SCHEMA_LISTS.filter((l) => l.enabled(c))) {
		const first = group[list.name] as Conn<unknown> | null | undefined;
		if (!first?.pageInfo?.hasNextPage) continue;
		const all = await collectPages(
			first,
			async (after) => {
				const page = await graphql<{ group?: Record<string, Conn<unknown> | null> | null }>(cfg, cred, schemaPageQuery(list), {
					fullPath: cfg.group,
					after
				});
				return page.data.group?.[list.name];
			},
			SCHEMA_LIST_MAX
		);
		group[list.name] = { nodes: all.nodes };
		if (all.capped) capped.push(list.label);
	}
	const reg = normalizeSchema(data, { iterations: c.iterations });
	if (capped.length) reg.warnings.push(`Only the first ${SCHEMA_LIST_MAX} ${capped.join(', ')} were loaded from GitLab.`);
	if (errors.length) reg.warnings.push('Some field information could not be loaded from GitLab (see the server log).');
	if (!c.status) reg.warnings.push('This GitLab has no work item statuses; completed items are taken from the closed state.');
	if (!c.customFields) reg.warnings.push('This GitLab has no custom fields API.');
	return reg;
}

interface ConnRoot {
	workItems?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: RawWorkItem[] };
}

/**
 * One connection, newest-updated first, page by page. Stops at the end, at `stopBefore` (closed
 * items older than the window), or at ITEMS_MAX, which exists so a misconfigured group (e.g. the
 * whole instance) can't hang the page. `capped` says the list was cut there, so the board can say
 * so instead of quietly showing part of the work.
 */
export async function fetchConnection(
	cfg: ServerConfig,
	cred: Credential,
	query: string,
	root: 'group' | 'project',
	fullPath: string,
	state: 'opened' | 'closed',
	stopBefore: number | null
): Promise<{ nodes: RawWorkItem[]; capped: boolean }> {
	const out: RawWorkItem[] = [];
	const max = cfg.itemsMax;
	let after: string | null = null;
	// The page count is bounded too: a cursor that never ends must not loop forever
	for (let page = 0; page < Math.ceil(max / PAGE_SIZE) + 1; page++) {
		const res: { data: Record<string, ConnRoot | null> } = await graphql<Record<string, ConnRoot | null>>(cfg, cred, query, {
			fullPath,
			state,
			after,
			first: Math.min(PAGE_SIZE, max - out.length)
		});
		const conn: ConnRoot['workItems'] = res.data[root]?.workItems;
		const nodes = (conn?.nodes ?? []).filter(Boolean);
		out.push(...nodes);
		const last = nodes[nodes.length - 1];
		// Sorted by updatedAt desc: once we're past the window, the rest is older.
		if (stopBefore !== null && last && Date.parse(last.updatedAt) < stopBefore) break;
		if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
		if (out.length >= max) return { nodes: out, capped: true };
		after = conn.pageInfo.endCursor;
	}
	return { nodes: out, capped: false };
}

async function fetchItems(
	cfg: ServerConfig,
	cred: Credential,
	c: Capabilities,
	reg: FieldRegistry
): Promise<ItemsEntry> {
	const cutoff = Date.now() - cfg.closedDaysMax * 86_400_000;
	const raw: RawWorkItem[] = [];
	const cut = { opened: false, closed: false };
	const add = async (query: string, root: 'group' | 'project', path: string, state: 'opened' | 'closed') => {
		const r = await fetchConnection(cfg, cred, query, root, path, state, state === 'closed' ? cutoff : null);
		raw.push(...r.nodes);
		if (r.capped) cut[state] = true;
	};
	const gq = groupWorkItemsQuery(c);
	await add(gq, 'group', cfg.group, 'opened');
	if (cfg.itemsMode === 'group') {
		if (cfg.closedDaysMax > 0) await add(gq, 'group', cfg.group, 'closed');
	} else {
		// Fallback: epics from the group, issues/tasks from each project.
		const pq = projectWorkItemsQuery(c);
		for (const p of reg.projects) {
			await add(pq, 'project', p.fullPath, 'opened');
			if (cfg.closedDaysMax > 0) await add(pq, 'project', p.fullPath, 'closed');
		}
	}

	const seen = emptySeen();
	const projectPaths = new Set(reg.projects.map((p) => p.fullPath));
	const byId = new Map<string, WorkItem>();
	for (const r of raw) {
		if (!r?.id || byId.has(r.id)) continue;
		const item = normalizeWorkItem(r, { projectPaths, seen });
		if (item.state === 'closed' && Date.parse(item.closedAt ?? item.updatedAt) < cutoff) continue;
		byId.set(item.id, item);
	}
	let items = [...byId.values()];
	if (cfg.labelFilter) items = applyLabelFilter(items, cfg.labelFilter, seen);
	const where = cfg.itemsMode === 'group' ? '' : ' per project';
	const warnings = (['opened', 'closed'] as const)
		.filter((k) => cut[k])
		.map(
			(k) =>
				`Only the ${cfg.itemsMax} most recently updated ${k === 'opened' ? 'open' : 'closed'} items${where} were loaded from GitLab; older ones are missing. Raise ITEMS_MAX or point GITLAB_GROUP at a smaller group.`
		);
	return { at: Date.now(), items, seen, warnings };
}

/** GITLAB_LABEL_FILTER: only items that have ALL of these labels (by title, case-insensitive). Epics are kept. */
function applyLabelFilter(items: WorkItem[], filter: string, seen: Seen): WorkItem[] {
	const wanted = filter
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const titleOf = (id: string) => seen.labels.get(id)?.label.toLowerCase();
	const keep = items.filter((i) => {
		const v = i.values['native:labels'];
		const titles = new Set(v?.kind === 'options' ? v.ids.map(titleOf) : []);
		return wanted.every((w) => titles.has(w));
	});
	const parents = new Set(keep.map((i) => i.parentId));
	return items.filter((i) => keep.includes(i) || parents.has(i.id));
}

async function fetchAll(session: Session, baseCfg: ServerConfig, key: string, forceSchema: boolean) {
	const cred = credentialFor(session, baseCfg);
	// GraphQL needs the group's path; GITLAB_GROUP may be a numeric id (review M6)
	const cfg = { ...baseCfg, group: await groupPath(baseCfg, cred) };
	const c = await capabilities(cfg, cred);
	let schema = schemaCache.get(key);
	if (!schema || forceSchema || Date.now() - schema.at >= cfg.schemaCacheMs) {
		schema = { at: Date.now(), registry: await fetchSchema(cfg, cred, c) };
		remember(schemaCache, key, schema);
	}
	const items = await fetchItems(cfg, cred, c, schema.registry);
	remember(itemsCache, key, items);
	return { schema, items };
}

function compose(cfg: ServerConfig, schema: SchemaEntry, items: ItemsEntry): BoardData {
	const merged = mergeSeen(schema.registry, items.seen, items.items);
	// A Set: the page lists warnings in a keyed {#each}, which must never see the same text twice
	const registry = items.warnings.length ? { ...merged, warnings: [...new Set([...merged.warnings, ...items.warnings])] } : merged;
	return {
		items: withEpics(items.items, registry),
		registry,
		fetchedAt: new Date(items.at).toISOString(),
		stale: false,
		problem: null,
		groupLabel: groupLabelFor(cfg),
		closedDaysMax: cfg.closedDaysMax
	};
}

const EMPTY_REGISTRY: FieldRegistry = { fields: [], people: [], projects: [], types: [], currentUserId: null, warnings: [] };

function emptyBoard(problem: LoadProblem, cfg: ServerConfig | null): BoardData {
	return {
		items: [],
		registry: EMPTY_REGISTRY,
		fetchedAt: null,
		stale: false,
		problem,
		groupLabel: cfg?.group ?? '',
		closedDaysMax: cfg?.closedDaysMax ?? 30
	};
}

export async function loadBoard(session: Session, opts: { refreshSchema?: boolean } = {}): Promise<BoardData> {
	let cfg: ServerConfig;
	try {
		cfg = serverConfig();
	} catch (err) {
		const message = err instanceof ConfigError ? err.message : 'Server configuration error.';
		return emptyBoard({ kind: 'config', message }, null);
	}

	if (session.kind === 'kiosk') {
		const check = await checkServiceToken(cfg);
		if (!check.ok) return emptyBoard({ kind: 'config', message: check.reason! }, cfg);
	}

	const key = viewerKey(session);
	const schemaHit = schemaCache.get(key);
	const itemsHit = itemsCache.get(key);
	if (
		!opts.refreshSchema &&
		schemaHit &&
		itemsHit &&
		Date.now() - itemsHit.at < cfg.cacheMs &&
		Date.now() - schemaHit.at < cfg.schemaCacheMs
	) {
		return compose(cfg, schemaHit, itemsHit);
	}

	let p = inFlight.get(key);
	if (!p) {
		p = fetchAll(session, cfg, key, !!opts.refreshSchema).finally(() => inFlight.delete(key));
		inFlight.set(key, p);
	}

	try {
		const { schema, items } = await p;
		return compose(cfg, schema, items);
	} catch (err) {
		if (err instanceof GitLabError && err.status === 401 && session.kind === 'user') {
			// Token revoked in GitLab (or the user was removed): drop their cached data too.
			forgetViewer(key);
			return emptyBoard({ kind: 'auth', message: 'GitLab no longer accepts your sign-in. Please sign in again.' }, cfg);
		}
		const problem: LoadProblem =
			err instanceof GitLabError
				? { kind: 'gitlab', status: err.status, message: err.message }
				: { kind: 'gitlab', status: 0, message: 'Unexpected error while loading issues.' };
		console.error('[gitlab]', key, problem.message, err instanceof GitLabError ? '' : err);
		// A network blip during standup shouldn't blank the screen: keep showing the last good data.
		// Only for 5xx/network errors, never for "access denied" ones.
		const transient = problem.kind === 'gitlab' && (problem.status === 0 || problem.status >= 500 || problem.status === 429);
		if (schemaHit && itemsHit && transient) return { ...compose(cfg, schemaHit, itemsHit), stale: true, problem };
		if (!transient) forgetViewer(key);
		return emptyBoard(problem, cfg);
	}
}

// ---- Used by the write path --------------------------------------------------------------------

/** The viewer's merged registry and items, loading them if needed. */
export async function boardFor(session: Session): Promise<BoardData> {
	return loadBoard(session);
}

/** After a successful write: put GitLab's returned item into the viewer's cache, no refetch. */
export function updateCachedItem(session: Session, raw: RawWorkItem): WorkItem | null {
	const key = viewerKey(session);
	const entry = itemsCache.get(key);
	const schema = schemaCache.get(key);
	const projectPaths = new Set(schema?.registry.projects.map((p) => p.fullPath) ?? []);
	const seen = entry?.seen ?? emptySeen();
	const item = normalizeWorkItem(raw, { projectPaths, seen });
	if (entry) {
		const i = entry.items.findIndex((x) => x.id === item.id);
		if (i === -1) entry.items = [item, ...entry.items];
		else entry.items = entry.items.map((x) => (x.id === item.id ? item : x));
	}
	return item;
}

/**
 * After a successful delete: drop the item from the viewer's cache. Its children lose their parent
 * link in GitLab (the link rows go with the parent), so here they stay without a parent; the next
 * fetch shows anything GitLab did beyond that. It's also forgotten as a parent, so it stops being
 * offered as a parent option.
 */
export function removeCachedItem(session: Session, id: string): void {
	const entry = itemsCache.get(viewerKey(session));
	if (!entry) return;
	entry.seen.parents.delete(id);
	entry.items = entry.items
		.filter((x) => x.id !== id)
		.map((x) => {
			if (x.parentId !== id) return x;
			const values = { ...x.values };
			delete values['native:parent'];
			return { ...x, parentId: null, values };
		});
}

export async function capabilitiesFor(session: Session): Promise<Capabilities> {
	const cfg = serverConfig();
	return capabilities(cfg, credentialFor(session, cfg));
}

/** Test hook */
export function _resetCaches() {
	caps = null;
	schemaCache.clear();
	itemsCache.clear();
	inFlight.clear();
}
