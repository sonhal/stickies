/**
 * Comments: request validation, quick-action neutralizing, reading GitLab's notes, the reply check,
 * and how GitLab's answers map to HTTP statuses. GitLab and the board cache are replaced by stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '$lib/testing/factory';
import { COMMENT_MAX } from '$lib/comments';
import type { Session } from '../session';

const h = vi.hoisted(() => ({ graphql: vi.fn(), loadBoard: vi.fn() }));
vi.mock('../config', () => ({ serverConfig: () => ({ writeRatePerMinute: 1000, gitlabUrl: 'http://gitlab.test' }) }));
vi.mock('../gitlab/client', async (orig) => ({ ...(await orig<typeof import('../gitlab/client')>()), graphql: h.graphql, credentialFor: () => ({ kind: 'oauth', token: 't' }) }));
vi.mock('../gitlab/load', () => ({ loadBoard: h.loadBoard }));

import { executeComment, normalizeComments, planComment, readComments, type RawComments } from './comments';
import { GitLabError } from '../gitlab/client';
import { COMMENTS_QUERY, createNoteMutation } from '../gitlab/queries';

const issue = item({}, { id: 'gid://gitlab/WorkItem/1' });
const items = [issue];
const user: Session = { v: 1, kind: 'user', user: { id: 7, username: 'a', name: 'A' }, accessToken: 't', refreshToken: 'r', expiresAt: 0, issuedAt: 0 };
const kiosk: Session = { v: 1, kind: 'kiosk', issuedAt: 0 };

const D1 = 'gid://gitlab/Discussion/abc123';
const note = (id: number, extra: Record<string, unknown> = {}) => ({
	id: `gid://gitlab/Note/${id}`,
	body: `note ${id}`,
	createdAt: `2026-11-0${id}T10:00:00Z`,
	system: false,
	internal: false,
	author: { id: 'gid://gitlab/User/7', username: 'a', name: 'A' },
	...extra
});
const notesAnswer = (discussions: unknown[], hasNextPage = false): { data: RawComments; errors: string[] } => ({
	data: { workItem: { id: issue.id, widgets: [{ type: 'DESCRIPTION' }, { type: 'NOTES', discussions: { pageInfo: { hasNextPage }, nodes: discussions as never } }] } },
	errors: []
});

describe('planComment', () => {
	it('builds createNote input from the board item, neutralizing quick actions', () => {
		const p = planComment({ itemId: issue.id, body: '  /close\nlooks good  ' }, items);
		expect(p.ok && p.input).toEqual({ noteableId: issue.id, body: '\\/close\nlooks good' });
	});

	it('passes a reply\'s discussion id', () => {
		const p = planComment({ itemId: issue.id, body: 'yes', discussionId: D1 }, items);
		expect(p.ok && p.input.discussionId).toBe(D1);
	});

	it.each([
		[{ itemId: issue.id, body: '   ' }, 400],
		[{ itemId: issue.id, body: 'x'.repeat(COMMENT_MAX + 1) }, 400],
		[{ itemId: issue.id, body: 'x', discussionId: 'gid://gitlab/Note/1' }, 400],
		[{ itemId: issue.id, body: 'x', noteableId: 'gid://gitlab/Project/1' }, 400],
		[{ itemId: 'gid://gitlab/WorkItem/999', body: 'x' }, 404],
		[{ itemId: 'gid://gitlab/Project/1', body: 'x' }, 400]
	])('refuses %j with %i', (raw, status) => {
		const p = planComment(raw, items);
		expect(p.ok).toBe(false);
		expect(!p.ok && p.status).toBe(status);
	});
});

describe('normalizeComments', () => {
	it('keeps people\'s comments, oldest first, and drops system notes, bad ids and empty threads', () => {
		const { threads, more } = normalizeComments(
			notesAnswer(
				[
					{ id: 'gid://gitlab/Discussion/bbb', notes: { nodes: [note(3), note(4, { internal: true })] } },
					{ id: D1, notes: { nodes: [note(2), note(1)] } },
					{ id: 'gid://gitlab/Discussion/ccc', notes: { nodes: [note(5, { system: true })] } },
					{ id: 'not-a-gid', notes: { nodes: [note(6)] } },
					null
				],
				true
			).data
		);
		expect(threads.map((t) => t.id)).toEqual([D1, 'gid://gitlab/Discussion/bbb']);
		expect(threads[0].comments.map((c) => c.body)).toEqual(['note 1', 'note 2']);
		expect(threads[1].comments[1].internal).toBe(true);
		expect(more).toBe(true);
	});

	it('drops an author with a malformed id rather than trusting it', () => {
		const { threads } = normalizeComments(notesAnswer([{ id: D1, notes: { nodes: [note(1, { author: { id: 'x', name: 'Mallory' } })] } }]).data);
		expect(threads[0].comments[0].author).toBeNull();
	});
});

describe('comment routes', () => {
	beforeEach(() => {
		h.graphql.mockReset();
		h.loadBoard.mockReset().mockResolvedValue({ items, problem: null, stale: false });
	});

	it('reading: the kiosk and items off the board are refused', async () => {
		expect((await readComments(kiosk, issue.id)).status).toBe(403);
		expect((await readComments(null, issue.id)).status).toBe(401);
		expect((await readComments(user, 'gid://gitlab/WorkItem/999')).status).toBe(404);
		expect(h.graphql).not.toHaveBeenCalled();
	});

	it('reading returns the threads', async () => {
		h.graphql.mockResolvedValue(notesAnswer([{ id: D1, notes: { nodes: [note(1)] } }]));
		const res = await readComments(user, issue.id);
		expect(res.status).toBe(200);
		expect((await res.json()).threads[0].comments[0].body).toBe('note 1');
		expect(h.graphql.mock.calls[0][2]).toBe(COMMENTS_QUERY);
	});

	it('posting a comment returns the new comment and its thread', async () => {
		h.graphql.mockResolvedValue({ data: { createNote: { errors: [], note: { ...note(9), discussion: { id: D1 } } } }, errors: [] });
		const res = await executeComment(user, { itemId: issue.id, body: 'hi' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, discussionId: D1, comment: { id: 'gid://gitlab/Note/9' } });
		expect(h.graphql.mock.calls[0][2]).toBe(createNoteMutation);
		expect(h.graphql.mock.calls[0][3]).toEqual({ input: { noteableId: issue.id, body: 'hi' } });
	});

	it('a reply must go to one of the item\'s own threads', async () => {
		h.graphql.mockResolvedValueOnce(notesAnswer([{ id: D1, notes: { nodes: [note(1)] } }]));
		const res = await executeComment(user, { itemId: issue.id, body: 'hi', discussionId: 'gid://gitlab/Discussion/fff' });
		expect(res.status).toBe(404);
		expect(h.graphql).toHaveBeenCalledTimes(1); // no createNote
	});

	it('GitLab refusing (no permission) is a 403', async () => {
		h.graphql.mockResolvedValue({
			data: { createNote: null },
			errors: ["The resource that you are attempting to access does not exist or you don't have permission to perform this action"]
		});
		expect((await executeComment(user, { itemId: issue.id, body: 'hi' })).status).toBe(403);
	});

	it('an expired sign-in is a 401', async () => {
		h.graphql.mockRejectedValue(new GitLabError('GitLab rejected the token.', 401));
		expect((await executeComment(user, { itemId: issue.id, body: 'hi' })).status).toBe(401);
	});
});
