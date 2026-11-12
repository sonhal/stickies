import { describe, expect, it } from 'vitest';
import { registry, selectField, item, opt, many } from '$lib/testing/factory';
import { neutralizeQuickActions, planCreate, planUpdate } from './validate';
import { guardWrite, originAllowed } from './guard';
import { RateLimiter } from './ratelimit';
import { mutationOutcome } from '../gitlab/mutations';
import { prefillToWrite } from '$lib/query/edit';
import type { Session } from '../session';
import type { FieldDef } from '$lib/fields/types';

const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low'], { appliesTo: ['Issue'] });
const comps: FieldDef = { ...selectField('custom:9', 'Components', ['API', 'Web']), kind: 'multiSelect', ordered: false };
const points: FieldDef = { key: 'custom:10', name: 'Points', kind: 'number', ordered: true, editable: true, appliesTo: [] };
const rating: FieldDef = { key: 'custom:12', name: 'Confidence', kind: 'text', ordered: false, editable: false, appliesTo: [], rawType: 'RATING' };
const reg = registry([prio, comps, points, rating]);

const epic = item({}, { id: 'gid://gitlab/WorkItem/900', type: 'Epic' });
const issue = item({ 'native:labels': many('l-bug', 'l-be') }, { id: 'gid://gitlab/WorkItem/1', parentId: epic.id });
const task = item({}, { id: 'gid://gitlab/WorkItem/2', type: 'Task', parentId: issue.id });
const items = [epic, issue, task];
const up = (field: string, value: unknown, itemId = issue.id) => planUpdate({ itemId, field, value }, reg, items);

describe('planUpdate: validation against the FieldRegistry', () => {
	it('builds a custom single-select write with the field GID', () => {
		const r = up('custom:7', prio.options![1].id);
		expect(r.ok && r.input).toEqual({
			id: issue.id,
			customFieldsWidget: [{ customFieldId: 'gid://gitlab/Issuables::CustomField/7', selectedOptionIds: [prio.options![1].id] }]
		});
		const clear = up('custom:7', null);
		expect(clear.ok && clear.input.customFieldsWidget).toEqual([{ customFieldId: 'gid://gitlab/Issuables::CustomField/7', selectedOptionIds: [] }]);
	});

	it('refuses an invalid option id', () => {
		const r = up('custom:7', 'gid://gitlab/Issuables::CustomFieldSelectOption/999');
		expect(r).toMatchObject({ ok: false, status: 400 });
		expect(up('native:status', 'not-a-status')).toMatchObject({ ok: false });
		expect(up('custom:9', ['custom:9/o1', 'nope'])).toMatchObject({ ok: false });
	});

	it('refuses a field that does not apply to the item type', () => {
		const r = up('custom:7', prio.options![0].id, task.id);
		expect(r).toMatchObject({ ok: false, status: 400 });
		expect(!r.ok && r.error).toMatch(/doesn't apply to a Task/);
	});

	it('refuses unknown, removed and read-only fields', () => {
		expect(up('custom:404', 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
		expect(up('custom:12', 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/can't be edited/) });
		expect(up('native:project', 'g/web')).toMatchObject({ ok: false });
		expect(up('native:updatedAt', '2026-01-01')).toMatchObject({ ok: false });
	});

	it('refuses items that are not on the viewer’s board and malformed requests', () => {
		expect(up('native:weight', 3, 'gid://gitlab/WorkItem/424242')).toMatchObject({ ok: false, status: 404 });
		expect(planUpdate({ itemId: 'gid://gitlab/Project/1', field: 'native:weight', value: 1 }, reg, items)).toMatchObject({ ok: false });
		expect(planUpdate({ itemId: issue.id, field: 'native:weight', value: 1, query: 'mutation { destroy }' }, reg, items)).toMatchObject({ ok: false });
		expect(planUpdate({ itemId: issue.id, field: 'name:Priority', value: 'High' }, reg, items)).toMatchObject({ ok: false });
		expect(planUpdate('nope', reg, items)).toMatchObject({ ok: false });
	});

	it('validates titles, weights and dates', () => {
		expect(up('title', '  New title\n')).toMatchObject({ ok: true, input: { id: issue.id, title: 'New title' } });
		expect(up('title', '   ')).toMatchObject({ ok: false });
		expect(up('title', 'x'.repeat(256))).toMatchObject({ ok: false });
		expect(up('native:weight', -1)).toMatchObject({ ok: false });
		expect(up('native:weight', 2.5)).toMatchObject({ ok: false });
		expect(up('native:weight', null)).toMatchObject({ ok: true, input: { weightWidget: { weight: null } } });
		expect(up('native:dueDate', '2026-02-30')).toMatchObject({ ok: false });
		expect(up('native:dueDate', '2026-12-01')).toMatchObject({ ok: true, input: { startAndDueDateWidget: { dueDate: '2026-12-01', isFixed: true } } });
		expect(up('custom:10', 'five')).toMatchObject({ ok: false });
	});

	it('diffs labels and enforces scoped-label exclusivity', () => {
		const r = up('native:labels', ['l-bug', 'l-fe']);
		expect(r.ok && r.input.labelsWidget).toEqual({ addLabelIds: ['l-fe'], removeLabelIds: ['l-be'] });
		const clash = up('native:labels', ['l-be', 'l-fe']);
		expect(clash).toMatchObject({ ok: false, error: expect.stringMatching(/"area::"/) });
	});

	it('sets and removes the parent, refusing cycles and unknown parents', () => {
		expect(up('native:parent', null)).toMatchObject({ ok: true, input: { hierarchyWidget: { parentId: null } } });
		expect(up('native:parent', epic.id)).toMatchObject({ ok: true });
		expect(up('native:parent', task.id)).toMatchObject({ ok: false });
		expect(up('native:parent', issue.id)).toMatchObject({ ok: false });
		expect(up('native:parent', 'gid://gitlab/WorkItem/31337')).toMatchObject({ ok: false });
	});

	it('only accepts people from the registry', () => {
		expect(up('native:assignees', ['u1'])).toMatchObject({ ok: true, input: { assigneesWidget: { assigneeIds: ['u1'] } } });
		expect(up('native:assignees', ['u999'])).toMatchObject({ ok: false });
	});
});

describe('planCreate', () => {
	it('builds a create input from prefilled values', () => {
		const r = planCreate(
			{ title: 'New', projectId: 'g/web', parentId: epic.id, values: { 'native:status': 's-todo', 'custom:7': prio.options![0].id, 'native:labels': ['l-bug'] } },
			reg,
			items,
			'g'
		);
		expect(r.ok && r.input).toEqual({
			namespacePath: 'g/web',
			workItemTypeId: 't1',
			title: 'New',
			statusWidget: { status: 's-todo' },
			customFieldsWidget: [{ customFieldId: 'gid://gitlab/Issuables::CustomField/7', selectedOptionIds: [prio.options![0].id] }],
			labelsWidget: { labelIds: ['l-bug'] },
			hierarchyWidget: { parentId: epic.id }
		});
	});

	it('refuses unknown projects, types, fields and bad titles', () => {
		expect(planCreate({ title: 'x', projectId: 'other/project' }, reg, items, 'g')).toMatchObject({ ok: false });
		expect(planCreate({ title: 'x', projectId: 'g/web', type: 'Incident' }, reg, items, 'g')).toMatchObject({ ok: false });
		expect(planCreate({ title: '', projectId: 'g/web' }, reg, items, 'g')).toMatchObject({ ok: false });
		expect(planCreate({ title: 'x', projectId: 'g/web', type: 'Task', values: { 'custom:7': prio.options![0].id } }, reg, items, 'g')).toMatchObject({ ok: false });
	});

	it('escapes quick actions in the description so GitLab does not run them (review M4)', () => {
		const description = '/move other-group/secret-project\nSome text\n  /assign @someone\n    /label ~in-a-code-block\nnot /a command';
		const r = planCreate({ title: 'x', projectId: 'g/web', description }, reg, items, 'g');
		expect(r.ok && r.input.description).toBe(
			'\\/move other-group/secret-project\nSome text\n  \\/assign @someone\n    /label ~in-a-code-block\nnot /a command'
		);
	});
});

describe('planCreate: epics are created in the group', () => {
	const epic2 = item({}, { id: 'gid://gitlab/WorkItem/901', type: 'Epic' });
	const all = [...items, epic2];
	const create = (body: Record<string, unknown>, group = 'acme/platform') => planCreate(body, reg, all, group);

	it('uses the server-side group path and needs no project', () => {
		const r = create({ title: 'Big thing', type: 'epic', description: '/move elsewhere', values: { 'native:labels': ['l-bug'], 'native:startDate': '2026-12-01' } });
		expect(r.ok && r.input).toEqual({
			namespacePath: 'acme/platform',
			workItemTypeId: 't8',
			title: 'Big thing',
			description: '\\/move elsewhere',
			labelsWidget: { labelIds: ['l-bug'] },
			startAndDueDateWidget: { startDate: '2026-12-01', isFixed: true }
		});
	});

	it('still refuses an issue or task without a project', () => {
		expect(create({ title: 'x' })).toMatchObject({ ok: false, error: expect.stringMatching(/projects/) });
		expect(create({ title: 'x', type: 'Task' })).toMatchObject({ ok: false });
	});

	it('refuses fields that do not apply to an epic', () => {
		const status = create({ title: 'x', type: 'Epic', values: { 'native:status': 's-todo' } });
		expect(status).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't apply to a Epic/) });
		expect(create({ title: 'x', type: 'Epic', values: { 'custom:7': prio.options![0].id } })).toMatchObject({ ok: false });
	});

	it('only accepts another epic on the board as the parent', () => {
		expect(create({ title: 'x', type: 'Epic', parentId: epic2.id })).toMatchObject({ ok: true, input: { hierarchyWidget: { parentId: epic2.id } } });
		expect(create({ title: 'x', type: 'Epic', parentId: issue.id })).toMatchObject({ ok: false, error: expect.stringMatching(/must be an epic/) });
		expect(create({ title: 'x', type: 'Epic', parentId: 'gid://gitlab/WorkItem/31337' })).toMatchObject({ ok: false });
	});

	it('does not let the browser choose the namespace', () => {
		// A project sent with an epic is ignored; unknown keys such as namespacePath fail the strict schema.
		expect(create({ title: 'x', type: 'Epic', projectId: 'g/web' })).toMatchObject({ ok: true, input: { namespacePath: 'acme/platform' } });
		expect(create({ title: 'x', type: 'Epic', projectId: 'other/group' })).toMatchObject({ ok: true, input: { namespacePath: 'acme/platform' } });
		expect(create({ title: 'x', type: 'Epic', namespacePath: 'other/group' })).toMatchObject({ ok: false, error: 'Invalid request' });
		expect(create({ title: 'x', projectId: 'g/web', namespacePath: 'other/group' })).toMatchObject({ ok: false });
	});

	it('refuses an epic when the group path is not known', () => {
		expect(create({ title: 'x', type: 'Epic' }, '')).toMatchObject({ ok: false });
	});
});

describe('neutralizeQuickActions', () => {
	it('escapes every line that starts with a slash, including CRLF text, and nothing else', () => {
		expect(neutralizeQuickActions('/clone x\r\n/spend 1h\r\nok')).toBe('\\/clone x\r\n\\/spend 1h\r\nok');
		expect(neutralizeQuickActions('a/b\nhttps://x/y')).toBe('a/b\nhttps://x/y');
	});
});

describe('guardWrite', () => {
	const user: Session = { v: 1, kind: 'user', user: { id: 7, username: 'a', name: 'A' }, accessToken: 't', refreshToken: 'r', expiresAt: 0, issuedAt: 0 };
	const kiosk: Session = { v: 1, kind: 'kiosk', issuedAt: 0 };
	const req = (headers: Record<string, string>, body = '{"a":1}') => new Request('http://board.test/api/items/update', { method: 'POST', headers, body });
	const good = { origin: 'http://board.test', 'content-type': 'application/json' };

	it('accepts a same-origin JSON request from a user', async () => {
		const r = await guardWrite(req(good), user, 'http://board.test', new RateLimiter(60));
		expect(r).toEqual({ ok: true, body: { a: 1 }, userKey: 'user:7' });
	});

	it('refuses the kiosk session', async () => {
		expect(await guardWrite(req(good), kiosk, 'http://board.test', new RateLimiter(60))).toMatchObject({ ok: false, status: 403 });
	});

	it('refuses a missing or foreign Origin (CSRF)', async () => {
		expect(await guardWrite(req({ 'content-type': 'application/json' }), user, 'http://board.test', new RateLimiter(60))).toMatchObject({ ok: false, status: 403 });
		expect(await guardWrite(req({ ...good, origin: 'https://evil.example' }), user, 'http://board.test', new RateLimiter(60))).toMatchObject({ ok: false, status: 403 });
		expect(originAllowed('http://board.test.evil.example', 'http://board.test')).toBe(false);
	});

	it('refuses non-JSON and oversized bodies, and no session', async () => {
		expect(await guardWrite(req({ ...good, 'content-type': 'text/plain' }), user, 'http://board.test', new RateLimiter(60))).toMatchObject({ status: 415 });
		expect(await guardWrite(req(good, 'x'.repeat(40_000)), user, 'http://board.test', new RateLimiter(60))).toMatchObject({ status: 413 });
		expect(await guardWrite(req(good), null, 'http://board.test', new RateLimiter(60))).toMatchObject({ status: 401 });
	});

	it('rate limits per session', async () => {
		const rl = new RateLimiter(3);
		for (let i = 0; i < 3; i++) expect((await guardWrite(req(good), user, 'http://board.test', rl)).ok).toBe(true);
		expect(await guardWrite(req(good), user, 'http://board.test', rl)).toMatchObject({ ok: false, status: 429 });
	});
});

describe('RateLimiter', () => {
	it('allows 60 per minute per key, then recovers', () => {
		const rl = new RateLimiter(60);
		const t0 = 1_000_000;
		for (let i = 0; i < 60; i++) expect(rl.take('a', t0 + i)).toBe(true);
		expect(rl.take('a', t0 + 100)).toBe(false);
		expect(rl.take('b', t0 + 100)).toBe(true);
		expect(rl.take('a', t0 + 60_001)).toBe(true);
	});
});

describe('mutationOutcome (review M2)', () => {
	it('passes a work item through', () => {
		expect(mutationOutcome({ workItem: { id: 'x' }, errors: [] }, [])).toEqual({ ok: true, workItem: { id: 'x' } });
	});

	it("turns GitLab's top-level ResourceNotAvailable into 'no permission' (403)", () => {
		const r = mutationOutcome(null, [
			"The resource that you are attempting to access does not exist or you don't have permission to perform this action"
		]);
		expect(r).toMatchObject({ ok: false, status: 403, error: "You don't have permission to change this in GitLab." });
	});

	it('keeps payload validation errors as 422 with their text', () => {
		const r = mutationOutcome({ workItem: null, errors: ["Title can't be blank"] }, []);
		expect(r).toMatchObject({ ok: false, status: 422 });
		expect(!r.ok && r.error).toContain("Title can't be blank");
	});

	it('falls back to a fixed text when GitLab says nothing', () => {
		expect(mutationOutcome(undefined, [])).toMatchObject({ ok: false, status: 422, error: 'GitLab rejected the change: no work item returned' });
	});
});

describe('create prefilled from a group or filter (review M8)', () => {
	// The dialog's prefill is always a string. These used to reach the server as strings and fail:
	// "Weight must be a whole number of 0 or more", "Components needs a list".
	const weight = reg.fields.find((f) => f.key === 'native:weight') ?? ({ key: 'native:weight', name: 'Weight', kind: 'number', ordered: true, editable: true, appliesTo: [] } as FieldDef);
	const regW = registry([prio, comps, points, rating, weight]);
	const create = (values: Record<string, unknown>) => planCreate({ title: 'New', projectId: 'g/web', values }, regW, items, 'g');

	it('converts by field kind, and the server accepts the result', () => {
		const values = {
			'native:weight': prefillToWrite(weight, '3'),
			'custom:10': prefillToWrite(points, '5'),
			'custom:9': prefillToWrite(comps, comps.options![0].id),
			'custom:7': prefillToWrite(prio, prio.options![1].id)
		};
		expect(values).toEqual({ 'native:weight': 3, 'custom:10': 5, 'custom:9': [comps.options![0].id], 'custom:7': prio.options![1].id });
		const r = create(values);
		expect(r.ok, !r.ok ? r.error : '').toBe(true);
	});

	it('the raw strings are what the server refused before', () => {
		expect(create({ 'native:weight': '3' })).toMatchObject({ ok: false });
		expect(create({ 'custom:9': comps.options![0].id })).toMatchObject({ ok: false });
	});

	it('drops values that cannot be set: read-only fields, non-numbers, bad dates', () => {
		expect(prefillToWrite(rating, 'x')).toBeNull();
		expect(prefillToWrite(points, 'abc')).toBeNull();
		const due: FieldDef = { key: 'native:dueDate', name: 'Due date', kind: 'date', ordered: true, editable: true, appliesTo: [] };
		expect(prefillToWrite(due, '2026-11-20')).toBe('2026-11-20');
		expect(prefillToWrite(due, 'soon')).toBeNull();
	});
});
