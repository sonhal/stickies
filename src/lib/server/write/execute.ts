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
import { planCreate, planUpdate } from './validate';

interface Payload {
	errors?: string[] | null;
	workItem?: RawWorkItem | null;
}

export type WriteResponse = { ok: true; item: WorkItem } | { ok: false; error: string };

const reply = (body: WriteResponse, status = 200) => json(body, { status, headers: { 'cache-control': 'no-store' } });

async function run(session: Session, kind: 'update' | 'create', input: Record<string, unknown>) {
	const cfg = serverConfig();
	const caps = await capabilitiesFor(session);
	const doc = kind === 'update' ? updateWorkItemMutation(caps) : createWorkItemMutation(caps);
	try {
		const { data, errors: topLevel } = await graphql<Record<string, Payload | null>>(cfg, credentialFor(session, cfg), doc, { input });
		const outcome = mutationOutcome(data[kind === 'update' ? 'workItemUpdate' : 'workItemCreate'], topLevel);
		if (!outcome.ok) {
			console.warn(`[write] ${kind} rejected by GitLab:`, outcome.log);
			return reply({ ok: false, error: outcome.error }, outcome.status);
		}
		const item = updateCachedItem(session, outcome.workItem);
		if (!item) return reply({ ok: false, error: 'GitLab answered, but the result could not be read.' }, 502);
		return reply({ ok: true, item });
	} catch (err) {
		if (err instanceof GitLabError) {
			const status = err.status === 401 ? 401 : err.status === 403 ? 403 : 502;
			const error =
				err.status === 401
					? 'GitLab no longer accepts your sign-in. Please sign in again.'
					: err.status === 403
						? "You don't have permission to change this in GitLab."
						: err.message;
			return reply({ ok: false, error }, status);
		}
		console.error('[write]', err);
		return reply({ ok: false, error: 'Unexpected error while saving.' }, 500);
	}
}

export async function executeUpdate(session: Session, body: unknown) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return reply({ ok: false, error: board.problem.message }, 503);
	const plan = planUpdate(body, board.registry, board.items);
	if (!plan.ok) return reply({ ok: false, error: plan.error }, plan.status);
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
