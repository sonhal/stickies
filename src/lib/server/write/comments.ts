/**
 * Comments (GitLab notes) on the board's items: reading them for one item, and adding, editing and
 * deleting a comment or reply.
 *
 * Reading: only for items on the viewer's own board, with the viewer's own token, so GitLab decides
 * what they see. Signed-in users see internal notes when GitLab shows them; the kiosk (a wall screen
 * anyone in the room can read) never does.
 *
 * Writing goes through the same checks as every other write: the route runs guardWrite first
 * (signed-in user, or the kiosk with KIOSK_EDIT; same origin, JSON, rate limit), then a plan function checks the request
 * against the viewer's board. The body's quick actions (`/close`, `/move` …) are neutralized, since
 * GitLab would otherwise run them from a comment and step outside the board's mutation allowlist.
 * A reply's discussion, and an edited or deleted note, must belong to that item: the server reads the
 * item's comments from GitLab and checks before it changes anything (for the kiosk, comments without
 * internal notes, so it can't touch one). Whether the viewer may edit or
 * delete a note is GitLab's decision (normally the author or a maintainer).
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
import { COMMENT_THREADS_MAX, COMMENTS_QUERY, createNoteMutation, destroyNoteMutation, updateNoteMutation } from '../gitlab/queries';
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
	lastEditedAt?: string | null;
	system?: boolean | null;
	internal?: boolean | null;
	author?: { id?: string | null; username?: string | null; name?: string | null } | null;
	userPermissions?: { adminNote?: boolean | null } | null;
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
const time = (s: unknown) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : null);

/** One GitLab note → a Comment, or null for a system note or anything malformed. */
export function normalizeNote(n: RawNote | null | undefined): Comment | null {
	if (!n || n.system || typeof n.id !== 'string' || !NOTE_ID.test(n.id) || typeof n.body !== 'string') return null;
	const a = n.author;
	const author =
		a && typeof a.id === 'string' && USER_ID.test(a.id)
			? { id: a.id, name: str(a.name, 200) || str(a.username, 100) || 'Unknown', username: str(a.username, 100) }
			: null;
	const createdAt = time(n.createdAt) ?? '';
	const edited = time(n.lastEditedAt);
	return {
		id: n.id,
		author,
		// Longer than the board shows: the rest is one click away in GitLab
		body: n.body.slice(0, COMMENT_MAX * 5),
		createdAt,
		editedAt: edited && edited !== createdAt ? edited : null,
		internal: n.internal === true,
		canEdit: n.userPermissions?.adminNote === true
	};
}

/**
 * GitLab's answer → threads, oldest first, without system notes or empty threads.
 * `includeInternal: false` (the kiosk) also leaves out internal notes.
 */
export function normalizeComments(data: RawComments, includeInternal = true): { threads: CommentThread[]; more: boolean } {
	const widget = (data.workItem?.widgets ?? []).find((w) => w && w.discussions);
	const threads: CommentThread[] = [];
	for (const d of widget?.discussions?.nodes ?? []) {
		if (!d || typeof d.id !== 'string' || !DISCUSSION_ID.test(d.id)) continue;
		const comments = (d.notes?.nodes ?? [])
			.map(normalizeNote)
			.filter((c): c is Comment => !!c && (includeInternal || !c.internal));
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
	return normalizeComments(data, session.kind === 'user');
}

// ---- Planning writes (pure; unit-tested) ---------------------------------------------------------

const ItemId = v.pipe(v.string(), v.maxLength(120), v.regex(ITEM_ID));
const NoteId = v.pipe(v.string(), v.maxLength(160), v.regex(NOTE_ID));
const Body = v.pipe(v.string(), v.maxLength(COMMENT_MAX * 2));

const CreateSchema = v.strictObject({
	itemId: ItemId,
	body: Body,
	discussionId: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(120), v.regex(DISCUSSION_ID))))
});
const EditSchema = v.strictObject({ itemId: ItemId, noteId: NoteId, body: Body });
const DeleteSchema = v.strictObject({ itemId: ItemId, noteId: NoteId });

export interface CommentPlan {
	ok: true;
	item: WorkItem;
	discussionId: string | null;
	input: { noteableId: string; body: string; discussionId?: string };
}
export interface EditPlan {
	ok: true;
	item: WorkItem;
	noteId: string;
	input: { id: string; body: string };
}
export interface DeletePlan {
	ok: true;
	item: WorkItem;
	noteId: string;
	input: { id: string };
}

const invalid: WriteError = { ok: false, status: 400, error: 'Invalid request' };
const offBoard: WriteError = { ok: false, status: 404, error: 'That item is not on your board (it may have been moved or you lost access)' };

/** A comment's text: trimmed, not empty, not too long, quick actions neutralized. */
function cleanBody(body: string): { ok: true; text: string } | WriteError {
	const text = body.trim();
	if (!text) return { ok: false, status: 400, error: "A comment can't be empty" };
	if (text.length > COMMENT_MAX) return { ok: false, status: 400, error: `A comment can be at most ${COMMENT_MAX.toLocaleString('en')} characters` };
	return { ok: true, text: neutralizeQuickActions(text) };
}

/** Browser input → the createNote input. */
export function planComment(raw: unknown, items: WorkItem[]): CommentPlan | WriteError {
	const parsed = v.safeParse(CreateSchema, raw);
	if (!parsed.success) return invalid;
	const c = parsed.output;
	const item = items.find((i) => i.id === c.itemId);
	if (!item) return offBoard;
	const body = cleanBody(c.body);
	if (!body.ok) return body;
	const discussionId = c.discussionId ?? null;
	// The id GitLab gets is the board's own, not the browser's string
	return { ok: true, item, discussionId, input: { noteableId: item.id, body: body.text, ...(discussionId ? { discussionId } : {}) } };
}

/** Browser input → the updateNote input. The note must still be checked against the item's comments. */
export function planEdit(raw: unknown, items: WorkItem[]): EditPlan | WriteError {
	const parsed = v.safeParse(EditSchema, raw);
	if (!parsed.success) return invalid;
	const item = items.find((i) => i.id === parsed.output.itemId);
	if (!item) return offBoard;
	const body = cleanBody(parsed.output.body);
	if (!body.ok) return body;
	return { ok: true, item, noteId: parsed.output.noteId, input: { id: parsed.output.noteId, body: body.text } };
}

/** Browser input → the destroyNote input. The note must still be checked against the item's comments. */
export function planDeleteComment(raw: unknown, items: WorkItem[]): DeletePlan | WriteError {
	const parsed = v.safeParse(DeleteSchema, raw);
	if (!parsed.success) return invalid;
	const item = items.find((i) => i.id === parsed.output.itemId);
	if (!item) return offBoard;
	return { ok: true, item, noteId: parsed.output.noteId, input: { id: parsed.output.noteId } };
}

// ---- Running them --------------------------------------------------------------------------------

const headers = { 'cache-control': 'private, no-store' };
type CommentReply =
	| { ok: true; comment: Comment; discussionId: string }
	| { ok: true; deleted: string }
	| { ok: false; error: string };
const answer = (body: CommentReply, status = 200) => json(body, { status, headers });

function gitlabFailure(err: GitLabError) {
	const status = err.status === 401 ? 401 : err.status === 403 ? 403 : err.status === 404 ? 404 : 502;
	const error =
		err.status === 401
			? 'GitLab no longer accepts your sign-in. Please sign in again.'
			: err.status === 403
				? "You don't have permission to do that in GitLab."
				: err.message;
	return answer({ ok: false, error }, status);
}

function rejected(kind: string, own: string[], topLevel: string[]) {
	const errors = own.length ? own : topLevel.length ? topLevel : ['no answer from GitLab'];
	console.warn(`[comment] ${kind} rejected by GitLab:`, errors.join(' | '));
	const denied = PERMISSION.test(errors.join(' '));
	return answer({ ok: false, error: denied ? "You don't have permission to do that in GitLab." : friendlyMutationError(errors) }, denied ? 403 : 422);
}

const notOnItem = () => answer({ ok: false, error: 'That comment is gone, or belongs to another item. Reload and try again.' }, 404);

interface NotePayload {
	errors?: (string | null)[] | null;
	note?: RawNote | null;
}

/** A createNote / updateNote answer → the reply for the browser. */
function noteAnswer(kind: string, payload: NotePayload | null | undefined, topLevel: string[]) {
	const own = (payload?.errors ?? []).filter((e): e is string => !!e);
	const note = normalizeNote(payload?.note);
	const discussionId = payload?.note?.discussion?.id;
	if (own.length || !note || typeof discussionId !== 'string' || !DISCUSSION_ID.test(discussionId)) return rejected(kind, own, topLevel);
	return answer({ ok: true, comment: note, discussionId });
}

async function boardFor(session: Session) {
	const board = await loadBoard(session);
	return board.problem && !board.stale ? { error: answer({ ok: false, error: board.problem.message }, 503) } : { board };
}

async function guarded(session: Session, run: () => Promise<Response>) {
	try {
		return await run();
	} catch (err) {
		if (err instanceof GitLabError) return gitlabFailure(err);
		console.error('[comment]', err);
		return answer({ ok: false, error: 'Unexpected error while saving the comment.' }, 500);
	}
}

const ownsNote = (threads: CommentThread[], noteId: string) => threads.some((t) => t.comments.some((c) => c.id === noteId));

export async function executeComment(session: Session, body: unknown) {
	const b = await boardFor(session);
	if (b.error) return b.error;
	const plan = planComment(body, b.board.items);
	if (!plan.ok) return answer({ ok: false, error: plan.error }, plan.status);
	const cfg = serverConfig();
	return guarded(session, async () => {
		if (plan.discussionId) {
			// A reply only goes into one of this item's own discussions
			const { threads } = await fetchComments(session, plan.item.id);
			if (!threads.some((t) => t.id === plan.discussionId)) {
				return answer({ ok: false, error: 'That thread is gone, or belongs to another item. Reload and try again.' }, 404);
			}
		}
		const { data, errors } = await graphql<{ createNote?: NotePayload | null }>(cfg, credentialFor(session, cfg), createNoteMutation, { input: plan.input });
		return noteAnswer('create', data.createNote, errors);
	});
}

export async function executeEditComment(session: Session, body: unknown) {
	const b = await boardFor(session);
	if (b.error) return b.error;
	const plan = planEdit(body, b.board.items);
	if (!plan.ok) return answer({ ok: false, error: plan.error }, plan.status);
	const cfg = serverConfig();
	return guarded(session, async () => {
		if (!ownsNote((await fetchComments(session, plan.item.id)).threads, plan.noteId)) return notOnItem();
		const { data, errors } = await graphql<{ updateNote?: NotePayload | null }>(cfg, credentialFor(session, cfg), updateNoteMutation, { input: plan.input });
		return noteAnswer('edit', data.updateNote, errors);
	});
}

export async function executeDeleteComment(session: Session, body: unknown) {
	const b = await boardFor(session);
	if (b.error) return b.error;
	const plan = planDeleteComment(body, b.board.items);
	if (!plan.ok) return answer({ ok: false, error: plan.error }, plan.status);
	const cfg = serverConfig();
	return guarded(session, async () => {
		if (!ownsNote((await fetchComments(session, plan.item.id)).threads, plan.noteId)) return notOnItem();
		const { data, errors } = await graphql<{ destroyNote?: { errors?: (string | null)[] | null } | null }>(
			cfg,
			credentialFor(session, cfg),
			destroyNoteMutation,
			{ input: plan.input }
		);
		const own = (data.destroyNote?.errors ?? []).filter((e): e is string => !!e);
		// No payload with top-level errors is GitLab's "no permission" (ResourceNotAvailable)
		if (own.length || !data.destroyNote) return rejected('delete', own, errors);
		return answer({ ok: true, deleted: plan.noteId });
	});
}

/** GET: the item's comments. Signed-in users and the kiosk (no internal notes). */
export async function readComments(session: Session | null, id: string) {
	if (!session) return json({ ok: false, error: 'Not signed in' }, { status: 401, headers });
	if (!ITEM_ID.test(id)) return json({ ok: false, error: 'Invalid request' }, { status: 400, headers });
	const board = await loadBoard(session);
	if (!board.items.some((i) => i.id === id)) return json({ ok: false, error: offBoard.error }, { status: 404, headers });
	try {
		const { threads, more } = await fetchComments(session, id);
		return json({ ok: true, threads, more }, { headers });
	} catch (err) {
		if (err instanceof GitLabError) return gitlabFailure(err);
		console.error('[comments]', err);
		return json({ ok: false, error: 'Unexpected error while loading the comments.' }, { status: 500, headers });
	}
}
