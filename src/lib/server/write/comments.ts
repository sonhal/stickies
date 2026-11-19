/**
 * Comments (GitLab notes) on the board's items: reading them for one item, and adding a comment or
 * a reply.
 *
 * Reading: signed-in users only (like the description editor), only for items on the viewer's own
 * board, with the viewer's own token, so GitLab decides what they see (internal notes included).
 *
 * Writing goes through the same checks as every other write: the route runs guardWrite first
 * (signed-in user, no kiosk, same origin, JSON, rate limit), then `planComment` checks the request
 * against the viewer's board. The body's quick actions (`/close`, `/move` …) are neutralized, since
 * GitLab would otherwise run them from a comment and step outside the board's mutation allowlist.
 * A reply's discussion must be one of that item's own discussions.
 */
import { json } from '@sveltejs/kit';
import * as v from 'valibot';
import { COMMENT_MAX, type Comment, type CommentThread } from '$lib/comments';
import type { WorkItem } from '$lib/fields/types';
import type { Session } from '../session';
import { serverConfig } from '../config';
import { credentialFor, GitLabError, graphql } from '../gitlab/client';
import { loadBoard } from '../gitlab/load';
import { friendlyMutationError, PERMISSION } from '../gitlab/mutations';
import { COMMENT_THREADS_MAX, COMMENTS_QUERY, createNoteMutation } from '../gitlab/queries';
import { neutralizeQuickActions, type WriteError } from './validate';

const ITEM_ID = /^gid:\/\/gitlab\/WorkItem\/\d+$/;
const NOTE_ID = /^gid:\/\/gitlab\/(?:[A-Za-z]+::)*[A-Za-z]*Note\/\d+$/;
const DISCUSSION_ID = /^gid:\/\/gitlab\/Discussion\/[0-9a-f]{1,64}$/;
const USER_ID = /^gid:\/\/gitlab\/User\/\d+$/;

// ---- Reading -------------------------------------------------------------------------------------

interface RawNote {
	id?: string | null;
	body?: string | null;
	createdAt?: string | null;
	system?: boolean | null;
	internal?: boolean | null;
	author?: { id?: string | null; username?: string | null; name?: string | null } | null;
	discussion?: { id?: string | null } | null;
}

interface RawDiscussion {
	id?: string | null;
	notes?: { nodes?: (RawNote | null)[] | null } | null;
}

export interface RawComments {
	workItem?: {
		id: string;
		widgets?: ({ type?: string; discussions?: { pageInfo?: { hasNextPage?: boolean | null } | null; nodes?: (RawDiscussion | null)[] | null } | null } | null)[] | null;
	} | null;
}

const str = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

/** One GitLab note → a Comment, or null for a system note or anything malformed. */
export function normalizeNote(n: RawNote | null | undefined): Comment | null {
	if (!n || n.system || typeof n.id !== 'string' || !NOTE_ID.test(n.id) || typeof n.body !== 'string') return null;
	const createdAt = typeof n.createdAt === 'string' && !Number.isNaN(Date.parse(n.createdAt)) ? n.createdAt : '';
	const a = n.author;
	const author =
		a && typeof a.id === 'string' && USER_ID.test(a.id)
			? { id: a.id, name: str(a.name, 200) || str(a.username, 100) || 'Unknown', username: str(a.username, 100) }
			: null;
	// Longer than the board shows: the rest is one click away in GitLab
	return { id: n.id, author, body: n.body.slice(0, COMMENT_MAX * 5), createdAt, internal: n.internal === true };
}

/** GitLab's answer → threads, oldest first, without system notes or empty threads. */
export function normalizeComments(data: RawComments): { threads: CommentThread[]; more: boolean } {
	const widget = (data.workItem?.widgets ?? []).find((w) => w && w.discussions);
	const threads: CommentThread[] = [];
	for (const d of widget?.discussions?.nodes ?? []) {
		if (!d || typeof d.id !== 'string' || !DISCUSSION_ID.test(d.id)) continue;
		const comments = (d.notes?.nodes ?? []).map(normalizeNote).filter((c): c is Comment => !!c);
		comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		if (comments.length) threads.push({ id: d.id, comments });
	}
	threads.sort((a, b) => a.comments[0].createdAt.localeCompare(b.comments[0].createdAt));
	return { threads, more: widget?.discussions?.pageInfo?.hasNextPage === true };
}

/** The item's comments, with the viewer's token. Throws GitLabError. */
export async function fetchComments(session: Session, itemId: string): Promise<{ threads: CommentThread[]; more: boolean }> {
	const cfg = serverConfig();
	const { data } = await graphql<RawComments>(cfg, credentialFor(session, cfg), COMMENTS_QUERY, { id: itemId, first: COMMENT_THREADS_MAX });
	if (!data.workItem) throw new GitLabError('That item no longer exists in GitLab, or you lost access.', 404);
	return normalizeComments(data);
}

// ---- Writing -------------------------------------------------------------------------------------

const CommentSchema = v.strictObject({
	itemId: v.pipe(v.string(), v.maxLength(120), v.regex(ITEM_ID)),
	body: v.pipe(v.string(), v.maxLength(COMMENT_MAX * 2)),
	discussionId: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(120), v.regex(DISCUSSION_ID))))
});

export interface CommentPlan {
	ok: true;
	item: WorkItem;
	discussionId: string | null;
	input: { noteableId: string; body: string; discussionId?: string };
}

/** Browser input → the createNote input. Pure; unit-tested. */
export function planComment(raw: unknown, items: WorkItem[]): CommentPlan | WriteError {
	const parsed = v.safeParse(CommentSchema, raw);
	if (!parsed.success) return { ok: false, status: 400, error: 'Invalid request' };
	const c = parsed.output;
	const item = items.find((i) => i.id === c.itemId);
	if (!item) return { ok: false, status: 404, error: 'That item is not on your board (it may have been moved or you lost access)' };
	const text = c.body.trim();
	if (!text) return { ok: false, status: 400, error: "A comment can't be empty" };
	if (text.length > COMMENT_MAX) return { ok: false, status: 400, error: `A comment can be at most ${COMMENT_MAX.toLocaleString('en')} characters` };
	const discussionId = c.discussionId ?? null;
	return {
		ok: true,
		item,
		discussionId,
		// The id GitLab gets is the board's own, not the browser's string
		input: { noteableId: item.id, body: neutralizeQuickActions(text), ...(discussionId ? { discussionId } : {}) }
	};
}

const headers = { 'cache-control': 'private, no-store' };
type CommentReply = { ok: true; comment: Comment; discussionId: string } | { ok: false; error: string };
const answer = (body: CommentReply, status = 200) => json(body, { status, headers });

function gitlabFailure(err: GitLabError) {
	const status = err.status === 401 ? 401 : err.status === 403 ? 403 : err.status === 404 ? 404 : 502;
	const error =
		err.status === 401
			? 'GitLab no longer accepts your sign-in. Please sign in again.'
			: err.status === 403
				? "You don't have permission to comment on this in GitLab."
				: err.message;
	return answer({ ok: false, error }, status);
}

export async function executeComment(session: Session, body: unknown) {
	const board = await loadBoard(session);
	if (board.problem && !board.stale) return answer({ ok: false, error: board.problem.message }, 503);
	const plan = planComment(body, board.items);
	if (!plan.ok) return answer({ ok: false, error: plan.error }, plan.status);
	const cfg = serverConfig();
	try {
		if (plan.discussionId) {
			// A reply only goes into one of this item's own discussions
			const { threads } = await fetchComments(session, plan.item.id);
			if (!threads.some((t) => t.id === plan.discussionId)) {
				return answer({ ok: false, error: 'That thread is gone, or belongs to another item. Reload and try again.' }, 404);
			}
		}
		const { data, errors: topLevel } = await graphql<{ createNote?: { errors?: (string | null)[] | null; note?: RawNote | null } | null }>(
			cfg,
			credentialFor(session, cfg),
			createNoteMutation,
			{ input: plan.input }
		);
		const own = (data.createNote?.errors ?? []).filter((e): e is string => !!e);
		const note = normalizeNote(data.createNote?.note);
		const discussionId = data.createNote?.note?.discussion?.id;
		if (own.length || !note || typeof discussionId !== 'string' || !DISCUSSION_ID.test(discussionId)) {
			const errors = own.length ? own : topLevel.length ? topLevel : ['no note returned'];
			console.warn('[comment] rejected by GitLab:', errors.join(' | '));
			const denied = PERMISSION.test(errors.join(' '));
			return answer({ ok: false, error: denied ? "You don't have permission to comment on this in GitLab." : friendlyMutationError(errors) }, denied ? 403 : 422);
		}
		return answer({ ok: true, comment: note, discussionId });
	} catch (err) {
		if (err instanceof GitLabError) return gitlabFailure(err);
		console.error('[comment]', err);
		return answer({ ok: false, error: 'Unexpected error while saving the comment.' }, 500);
	}
}

/** GET: the item's comments. Same access rules as the description editor. */
export async function readComments(session: Session | null, id: string) {
	if (!session) return json({ ok: false, error: 'Not signed in' }, { status: 401, headers });
	if (session.kind !== 'user') return json({ ok: false, error: 'The kiosk screen is read-only' }, { status: 403, headers });
	if (!ITEM_ID.test(id)) return json({ ok: false, error: 'Invalid request' }, { status: 400, headers });
	const board = await loadBoard(session);
	if (!board.items.some((i) => i.id === id)) {
		return json({ ok: false, error: 'That item is not on your board (it may have been moved or you lost access)' }, { status: 404, headers });
	}
	try {
		const { threads, more } = await fetchComments(session, id);
		return json({ ok: true, threads, more }, { headers });
	} catch (err) {
		if (err instanceof GitLabError) return gitlabFailure(err);
		console.error('[comments]', err);
		return json({ ok: false, error: 'Unexpected error while loading the comments.' }, { status: 500, headers });
	}
}
