/**
 * Deleting a work item: request validation, the guard on the route, and how GitLab's answers map
 * to HTTP statuses. GitLab and the board cache are replaced by stubs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { item } from '$lib/testing/factory';
import type { Session } from '../session';

const h = vi.hoisted(() => ({
	graphql: vi.fn(),
	loadBoard: vi.fn(),
	removeCachedItem: vi.fn()
}));
vi.mock('../config', () => ({ serverConfig: () => ({ writeRatePerMinute: 1000, gitlabUrl: 'http://gitlab.test' }) }));
vi.mock('../gitlab/client', async (orig) => ({ ...(await orig<typeof import('../gitlab/client')>()), graphql: h.graphql, credentialFor: () => ({ kind: 'oauth', token: 't' }) }));
vi.mock('../gitlab/load', () => ({ loadBoard: h.loadBoard, removeCachedItem: h.removeCachedItem }));

import { executeDelete, planDelete } from './delete';
import { deleteOutcome } from '../gitlab/mutations';
import { GitLabError } from '../gitlab/client';
import { deleteWorkItemMutation } from '../gitlab/queries';
import { POST } from '../../../routes/api/items/delete/+server';

const epic = item({}, { id: 'gid://gitlab/WorkItem/900', type: 'Epic' });
const issue = item({}, { id: 'gid://gitlab/WorkItem/1', parentId: epic.id });
const items = [epic, issue];

const user: Session = { v: 1, kind: 'user', user: { id: 7, username: 'a', name: 'A' }, accessToken: 't', refreshToken: 'r', expiresAt: 0, issuedAt: 0 };
const kiosk: Session = { v: 1, kind: 'kiosk', issuedAt: 0 };

describe('planDelete', () => {
	it('accepts an item on the board and sends only its id', () => {
		expect(planDelete({ itemId: issue.id }, items)).toEqual({ ok: true, item: issue, input: { id: issue.id } });
		expect(planDelete({ itemId: epic.id }, items)).toMatchObject({ ok: true, input: { id: epic.id } });
	});

	it('refuses an item that is not on the viewer’s board with 404', () => {
		expect(planDelete({ itemId: 'gid://gitlab/WorkItem/424242' }, items)).toMatchObject({ ok: false, status: 404 });
	});

	it('refuses malformed ids and extra keys with 400', () => {
		for (const body of [
			{ itemId: 'gid://gitlab/Project/1' },
			{ itemId: '1' },
			{ itemId: `${issue.id} ` },
			{ itemId: 1 },
			{ itemId: issue.id, query: 'mutation { destroy }' },
			{},
			'nope',
			null
		])
			expect(planDelete(body, items), JSON.stringify(body)).toMatchObject({ ok: false, status: 400 });
	});
});

describe('deleteOutcome', () => {
	it('is a success only with a payload and no errors', () => {
		expect(deleteOutcome({ errors: [] }, [])).toEqual({ ok: true });
		expect(deleteOutcome({ errors: null }, [])).toEqual({ ok: true });
	});

	it('turns GitLab’s no-permission shape (null payload, top-level error) into 403', () => {
		const r = deleteOutcome(null, ["The resource that you are attempting to access does not exist or you don't have permission to perform this action"]);
		expect(r).toMatchObject({ ok: false, status: 403, error: "You don't have permission to delete this in GitLab." });
	});

	it('reports other errors as 422', () => {
		expect(deleteOutcome({ errors: ['Something broke'] }, [])).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/Something broke/) });
		expect(deleteOutcome(null, [])).toMatchObject({ ok: false, status: 422 });
	});
});

describe('executeDelete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.loadBoard.mockResolvedValue({ items, registry: {}, problem: null, stale: false });
	});

	it('sends the allowlisted mutation with the board’s id, then drops the item from the cache', async () => {
		h.graphql.mockResolvedValue({ data: { workItemDelete: { errors: [] } }, errors: [] });
		const res = await executeDelete(user, { itemId: issue.id });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(h.graphql).toHaveBeenCalledWith(expect.anything(), expect.anything(), deleteWorkItemMutation, { input: { id: issue.id } });
		expect(h.removeCachedItem).toHaveBeenCalledWith(user, issue.id);
	});

	it('does not call GitLab for an item that is not on the board', async () => {
		const res = await executeDelete(user, { itemId: 'gid://gitlab/WorkItem/5' });
		expect(res.status).toBe(404);
		expect(h.graphql).not.toHaveBeenCalled();
	});

	it('maps GitLab refusing to 403 and keeps the cache', async () => {
		h.graphql.mockResolvedValue({ data: { workItemDelete: null }, errors: ["You don't have permission to perform this action"] });
		const res = await executeDelete(user, { itemId: issue.id });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ ok: false, error: "You don't have permission to delete this in GitLab." });
		expect(h.removeCachedItem).not.toHaveBeenCalled();
	});

	it('maps an expired sign-in to 401 and GitLab trouble to 502', async () => {
		h.graphql.mockRejectedValueOnce(new GitLabError('GitLab rejected the token.', 401));
		expect((await executeDelete(user, { itemId: issue.id })).status).toBe(401);
		h.graphql.mockRejectedValueOnce(new GitLabError('GitLab returned an error.', 500));
		expect((await executeDelete(user, { itemId: issue.id })).status).toBe(502);
		expect(h.removeCachedItem).not.toHaveBeenCalled();
	});
});

describe('POST /api/items/delete runs the write guard first', () => {
	beforeEach(() => vi.clearAllMocks());
	const call = (session: Session | null, headers: Record<string, string>) =>
		POST({
			request: new Request('http://board.test/api/items/delete', { method: 'POST', headers, body: JSON.stringify({ itemId: issue.id }) }),
			locals: { session },
			url: new URL('http://board.test/api/items/delete')
		} as unknown as Parameters<typeof POST>[0]);
	const good = { origin: 'http://board.test', 'content-type': 'application/json' };

	it('refuses the kiosk, cross-site requests and signed-out callers without touching GitLab', async () => {
		expect((await call(kiosk, good)).status).toBe(403);
		expect((await call(user, { ...good, origin: 'https://evil.example' })).status).toBe(403);
		expect((await call(user, { 'content-type': 'application/json' })).status).toBe(403);
		expect((await call(null, good)).status).toBe(401);
		expect(h.loadBoard).not.toHaveBeenCalled();
		expect(h.graphql).not.toHaveBeenCalled();
	});

	it('lets a same-origin request from a user through', async () => {
		h.loadBoard.mockResolvedValue({ items, registry: {}, problem: null, stale: false });
		h.graphql.mockResolvedValue({ data: { workItemDelete: { errors: [] } }, errors: [] });
		expect((await call(user, good)).status).toBe(200);
	});
});
