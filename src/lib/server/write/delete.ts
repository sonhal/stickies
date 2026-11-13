/**
 * Deleting a work item (any type, epics too): `{ itemId }` → the allowlisted workItemDelete.
 *
 * Same path as the other writes: the route runs guardWrite first (signed-in user, no kiosk,
 * same origin, JSON, rate limit), then the item must be on the viewer's own board. The id sent to
 * GitLab is the one from the board, not the browser's string. The board's `canDelete` hint is NOT
 * checked here: GitLab decides with the user's own token (normally only project Owners may delete),
 * and a refusal comes back as 403 "You don't have permission…".
 *
 * Children: GitLab removes the parent links along with the parent, so issues and tasks under the
 * deleted item stay, without a parent. The cache and the browser clear their parent at once; the
 * next refresh shows anything else GitLab did (see the README).
 */
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import type { WorkItem } from '$lib/fields/types';
import type { Session } from '../session';
import { serverConfig } from '../config';
import { credentialFor, GitLabError, graphql } from '../gitlab/client';
import { loadBoard, removeCachedItem } from '../gitlab/load';
import { deleteOutcome } from '../gitlab/mutations';
import { deleteWorkItemMutation } from '../gitlab/queries';
import { reply } from './execute';
import type { WriteError } from './validate';

/** Same id format as an update's itemId (validate.ts) */
const DeleteSchema = v.strictObject({ itemId: v.pipe(v.string(), v.maxLength(120), v.regex(/^gid:\/\/gitlab\/WorkItem\/\d+$/)) });

export interface DeletePlan {
	ok: true;
	item: WorkItem;
	input: { id: string };
}

/** Pure; unit-tested. */
export function planDelete(raw: unknown, items: WorkItem[]): DeletePlan | WriteError {
	const parsed = v.safeParse(DeleteSchema, raw);
	if (!parsed.success) return { ok: false, status: 400, error: 'Invalid request' };
	const item = items.find((i) => i.id === parsed.output.itemId);
	if (!item) return { ok: false, status: 404, error: 'That item is not on your board (it may have been moved or you lost access)' };
	return { ok: true, item, input: { id: item.id } };
}

export async function executeDelete(session: Session, body: unknown) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return reply({ ok: false, error: board.problem.message }, 503);
	const plan = planDelete(body, board.items);
	if (!plan.ok) return reply({ ok: false, error: plan.error }, plan.status);

	const cfg = serverConfig();
	try {
		const { data, errors } = await graphql<{ workItemDelete?: { errors?: string[] | null } | null }>(
			cfg,
			credentialFor(session, cfg),
			deleteWorkItemMutation,
			{ input: plan.input }
		);
		const outcome = deleteOutcome(data.workItemDelete, errors);
		if (!outcome.ok) {
			console.warn('[write] delete rejected by GitLab:', outcome.log);
			return reply({ ok: false, error: outcome.error }, outcome.status);
		}
		removeCachedItem(session, plan.item.id);
		return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		if (err instanceof GitLabError) {
			const status = err.status === 401 ? 401 : err.status === 403 ? 403 : 502;
			const error =
				err.status === 401
					? 'GitLab no longer accepts your sign-in. Please sign in again.'
					: err.status === 403
						? "You don't have permission to delete this in GitLab."
						: err.message;
			return reply({ ok: false, error }, status);
		}
		console.error('[write] delete', err);
		return reply({ ok: false, error: 'Unexpected error while deleting.' }, 500);
	}
}
