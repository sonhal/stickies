/**
 * Runs a validated write against GitLab with the user's own token, then updates the viewer's
 * cache entry in place (no full refetch). GitLab still enforces permissions.
 */
import { json } from '@sveltejs/kit';
import type { WorkItem } from '$lib/fields/types';
import { serverConfig } from '../config';
import type { Session } from '../session';
import { credentialFor, GitLabError, graphql } from '../gitlab/client';
import { capabilitiesFor, loadBoard, updateCachedItem } from '../gitlab/load';
import { mutationOutcome } from '../gitlab/mutations';
import type { RawWorkItem } from '../gitlab/normalize';
import { createWorkItemMutation, updateWorkItemMutation } from '../gitlab/queries';
import { planBulk, planCreate, planUpdate } from './validate';
import { descriptionVersion, fetchDescription } from './description';

interface Payload {
	errors?: string[] | null;
	workItem?: RawWorkItem | null;
}

export type WriteResponse = { ok: true; item: WorkItem } | { ok: false; error: string };

const reply = (body: WriteResponse, status = 200) => json(body, { status, headers: { 'cache-control': 'no-store' } });

type RunResult = { ok: true; item: WorkItem } | { ok: false; error: string; status: number };

/** One allowlisted mutation with the session's own token; the cache entry is updated in place. */
async function runOne(session: Session, kind: 'update' | 'create', input: Record<string, unknown>): Promise<RunResult> {
	const cfg = serverConfig();
	const caps = await capabilitiesFor(session);
	const doc = kind === 'update' ? updateWorkItemMutation(caps) : createWorkItemMutation(caps);
	try {
		const { data, errors: topLevel } = await graphql<Record<string, Payload | null>>(cfg, credentialFor(session, cfg), doc, { input });
		const outcome = mutationOutcome(data[kind === 'update' ? 'workItemUpdate' : 'workItemCreate'], topLevel);
		if (!outcome.ok) {
			console.warn(`[write] ${kind} rejected by GitLab:`, outcome.log);
			return { ok: false, error: outcome.error, status: outcome.status };
		}
		const item = updateCachedItem(session, outcome.workItem);
		if (!item) return { ok: false, error: 'GitLab answered, but the result could not be read.', status: 502 };
		return { ok: true, item };
	} catch (err) {
		if (err instanceof GitLabError) {
			const status = err.status === 401 ? 401 : err.status === 403 ? 403 : 502;
			const error =
				err.status === 401
					? 'GitLab no longer accepts your sign-in. Please sign in again.'
					: err.status === 403
						? "You don't have permission to change this in GitLab."
						: err.message;
			return { ok: false, error, status };
		}
		console.error('[write]', err);
		return { ok: false, error: 'Unexpected error while saving.', status: 500 };
	}
}

async function run(session: Session, kind: 'update' | 'create', input: Record<string, unknown>) {
	const r = await runOne(session, kind, input);
	return r.ok ? reply({ ok: true, item: r.item }) : reply({ ok: false, error: r.error }, r.status);
}

/** GitLab calls a bulk edit makes at the same time: quick for 50 items, gentle on GitLab. */
const BULK_CONCURRENCY = 4;

export type BulkResult = { itemId: string; ok: true; item: WorkItem } | { itemId: string; ok: false; error: string };

/** Runs `fn` over `list` with at most `limit` calls in flight; results keep the order of `list`. */
export async function pool<T, R>(list: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(list.length);
	let next = 0;
	const worker = async () => {
		while (next < list.length) {
			const i = next++;
			out[i] = await fn(list[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
	return out;
}

/**
 * Bulk edit: one field on many items (see planBulk). All changes are validated before any is
 * sent. `charge(n)` takes the rate-limit hits for the whole request up front (one per item, so a
 * bulk edit can't get around WRITE_RATE_PER_MINUTE) and returns how many were left when it refuses.
 * GitLab can still refuse single items (permissions differ per project): each gets its own result.
 */
export async function executeBulk(session: Session, body: unknown, charge: (n: number) => true | number) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return reply({ ok: false, error: board.problem.message }, 503);
	const plan = planBulk(body, board.registry, board.items);
	if (!plan.ok) return reply({ ok: false, error: plan.error }, plan.status);
	const charged = charge(plan.plans.length);
	if (charged !== true) {
		return reply(
			{
				ok: false,
				error: `That's ${plan.plans.length} changes, and you can make ${charged} more this minute. Select fewer items, or wait a minute.`
			},
			429
		);
	}
	const results = await pool(plan.plans, BULK_CONCURRENCY, async (p): Promise<BulkResult> => {
		const r = await runOne(session, 'update', p.input);
		return r.ok ? { itemId: p.item.id, ok: true, item: r.item } : { itemId: p.item.id, ok: false, error: r.error };
	});
	return json({ ok: true, results }, { headers: { 'cache-control': 'no-store' } });
}

export async function executeUpdate(session: Session, body: unknown) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return reply({ ok: false, error: board.problem.message }, 503);
	const plan = planUpdate(body, board.registry, board.items);
	if (!plan.ok) return reply({ ok: false, error: plan.error }, plan.status);
	if (plan.baseVersion) {
		// Don't save over a description someone changed after this editor loaded it
		try {
			const current = await fetchDescription(session, plan.item.id);
			if (descriptionVersion(current) !== plan.baseVersion) {
				return json(
					{ ok: false, conflict: true, error: 'Someone changed this description in GitLab while you were editing. Your text has not been saved.' },
					{ status: 409, headers: { 'cache-control': 'no-store' } }
				);
			}
		} catch (err) {
			if (err instanceof GitLabError) return reply({ ok: false, error: err.message }, [401, 403, 404].includes(err.status) ? err.status : 502);
			throw err;
		}
	}
	return run(session, 'update', plan.input);
}

export async function executeCreate(session: Session, body: unknown) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return reply({ ok: false, error: board.problem.message }, 503);
	// The group path comes from the loaded board (GITLAB_GROUP resolved to a path), never from the request.
	const plan = planCreate(body, board.registry, board.items, board.groupLabel);
	if (!plan.ok) return reply({ ok: false, error: plan.error }, plan.status);
	return run(session, 'create', plan.input);
}

export { reply };
