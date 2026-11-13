/**
 * Optimistic writes with responses that arrive out of order (review M3).
 * fetch is replaced by a stub whose responses we resolve by hand, in any order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { BoardState } from './board.svelte';
import { UiState } from './ui.svelte';
import { item, registry, selectField, opt } from '$lib/testing/factory';
import type { BoardData, WorkItem } from '$lib/fields/types';

type Reply = { status: number; body: unknown };
function stubFetch() {
	const calls: { body: { itemId: string; field: string; value: unknown }; reply: (r: Reply) => void }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn((_url: string, init: { body: string }) =>
			new Promise((resolve) => {
				calls.push({
					body: JSON.parse(init.body),
					reply: (r) => resolve({ ok: r.status < 400, status: r.status, json: async () => r.body })
				});
			})
		)
	);
	return calls;
}
const ok = (i: WorkItem): Reply => ({ status: 200, body: { ok: true, item: i } });
const fail: Reply = { status: 403, body: { ok: false, error: 'nope' } };
const tick = () => new Promise((r) => setTimeout(r, 0));

const prio = selectField('custom:7', 'Priority', ['High', 'Low'], { editable: true });
function setup(title = 'Original') {
	const it0 = item({ 'custom:7': opt(prio.options![1].id) }, { title });
	const data: BoardData = {
		items: [it0],
		registry: registry([prio]),
		fetchedAt: null,
		stale: false,
		problem: null,
		groupLabel: 'g',
		closedDaysMax: 30
	};
	const b = new BoardState(data);
	b.notify = () => {};
	const shown = () => b.byId.get(it0.id)!;
	return { b, it0, data, shown };
}

afterEach(() => vi.unstubAllGlobals());

describe('BoardState.update with out-of-order responses (review M3)', () => {
	it('a slow failure does not undo a newer success (the review scenario)', async () => {
		const calls = stubFetch();
		const { b, it0, shown } = setup('Slow query on the audit log');
		const first = b.update(it0.id, 'title', 'First');
		const second = b.update(it0.id, 'title', 'Second edit wins');
		calls[1].reply(ok({ ...it0, title: 'Second edit wins' })); // fast success
		await second;
		calls[0].reply(fail); // slow failure
		await first;
		flushSync();
		expect(shown().title).toBe('Second edit wins');
	});

	it('a late success for an older write does not overwrite a newer value', async () => {
		const calls = stubFetch();
		const { b, it0, shown } = setup();
		const first = b.update(it0.id, 'title', 'A');
		const second = b.update(it0.id, 'title', 'B');
		calls[1].reply(ok({ ...it0, title: 'B' }));
		await second;
		calls[0].reply(ok({ ...it0, title: 'A' }));
		await first;
		flushSync();
		expect(shown().title).toBe('B');
	});

	it('a response for one field keeps a newer in-flight write to another field', async () => {
		const calls = stubFetch();
		const { b, it0, shown } = setup();
		const high = prio.options![0].id;
		const t = b.update(it0.id, 'title', 'New title');
		const p = b.update(it0.id, 'custom:7', high);
		calls[0].reply(ok({ ...it0, title: 'New title' })); // GitLab's item still has the old priority
		await t;
		flushSync();
		expect(shown().title).toBe('New title');
		expect(shown().values['custom:7']).toEqual({ kind: 'option', id: high });
		calls[1].reply(ok({ ...it0, title: 'New title', values: { ...it0.values, 'custom:7': { kind: 'option', id: high } } }));
		await p;
	});

	it('a failure with no newer write rolls back to what GitLab last confirmed', async () => {
		const calls = stubFetch();
		const { b, it0, shown } = setup('Original');
		const w = b.update(it0.id, 'title', 'Nope');
		expect(shown().title).toBe('Nope');
		calls[0].reply(fail);
		await w;
		flushSync();
		expect(shown().title).toBe('Original');
	});

	it('pending stays set until the last write for the item finishes, so a refresh keeps it', async () => {
		const calls = stubFetch();
		const { b, it0, data, shown } = setup();
		const first = b.update(it0.id, 'title', 'A');
		const second = b.update(it0.id, 'title', 'B');
		calls[0].reply(ok({ ...it0, title: 'A' }));
		await first;
		await tick();
		expect(b.pending.has(it0.id)).toBe(true);
		b.setData({ ...data, items: [{ ...it0, title: 'stale from refresh' }] });
		flushSync();
		expect(shown().title).toBe('B');
		calls[1].reply(ok({ ...it0, title: 'B' }));
		await second;
		expect(b.pending.has(it0.id)).toBe(false);
	});
});

describe('BoardState.undo', () => {
	/** Answer every write at once with the item as it now shows (the optimistic value). */
	function echoFetch(b: BoardState, failing = new Set<number>()) {
		const sent: { itemId: string; field: string; value: unknown }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: { body: string }) => {
				const body = JSON.parse(init.body);
				sent.push(body);
				if (failing.has(sent.length)) return { ok: false, status: 403, json: async () => fail.body };
				const now = b.byId.get(body.itemId)!;
				return { ok: true, status: 200, json: async () => ({ ok: true, item: now }) };
			})
		);
		return sent;
	}
	const notes = (b: BoardState) => {
		const out: string[] = [];
		b.notify = (t) => out.push(t);
		return out;
	};

	it('writes back the previous value, newest change first, and says which item', async () => {
		const { b, it0, shown } = setup('Original');
		const sent = echoFetch(b);
		const said = notes(b);
		const low = prio.options![1].id;
		const high = prio.options![0].id;
		await b.update(it0.id, 'title', 'Renamed');
		await b.update(it0.id, 'custom:7', high);
		expect(await b.undo()).toBe(true);
		expect(sent.at(-1)).toEqual({ itemId: it0.id, field: 'custom:7', value: low });
		expect(shown().values['custom:7']).toEqual({ kind: 'option', id: low });
		expect(said.at(-1)).toBe(`Undone: ${it0.ref}`);
		await b.undo();
		expect(shown().title).toBe('Original');
		expect(sent).toHaveLength(4);
	});

	it('an undo is not itself undoable, and an empty stack says so', async () => {
		const { b, it0 } = setup('Original');
		const sent = echoFetch(b);
		const said = notes(b);
		await b.update(it0.id, 'title', 'Renamed');
		await b.undo();
		expect(await b.undo()).toBe(false);
		expect(said.at(-1)).toBe('Nothing to undo');
		expect(sent).toHaveLength(2);
	});

	it('remembers only saved changes, and keeps an undo that could not be saved', async () => {
		const { b, it0, shown } = setup('Original');
		echoFetch(b, new Set([2, 3])); // the second change and the first undo attempt are refused
		notes(b);
		await b.update(it0.id, 'title', 'Renamed');
		await b.update(it0.id, 'title', 'Refused');
		expect(await b.undo()).toBe(false);
		expect(await b.undo()).toBe(true);
		expect(shown().title).toBe('Original');
	});

	it('clears a value that was empty before, and keeps at most 20 steps', async () => {
		const { b, it0, shown } = setup();
		const sent = echoFetch(b);
		notes(b);
		await b.update(it0.id, 'native:weight', 3);
		await b.undo();
		expect(sent.at(-1)?.value).toBeNull();
		expect(shown().values['native:weight']).toBeUndefined();
		for (let n = 1; n <= 25; n++) await b.update(it0.id, 'title', `T${n}`);
		let undone = 0;
		while (await b.undo()) undone++;
		expect(undone).toBe(20);
		expect(shown().title).toBe('T5');
	});

	it('takes back a change that is still saving, and the undo wins whatever answers first', async () => {
		const calls = stubFetch();
		const { b, it0, shown } = setup('Original');
		const said = notes(b);
		const w = b.update(it0.id, 'title', 'Renamed');
		const u = b.undo(); // pressed before GitLab answered
		expect(calls[1].body).toEqual({ itemId: it0.id, field: 'title', value: 'Original' });
		calls[1].reply(ok({ ...it0, title: 'Original' }));
		await u;
		calls[0].reply(ok({ ...it0, title: 'Renamed' })); // the older write answers last
		await w;
		flushSync();
		expect(shown().title).toBe('Original');
		expect(said.at(-1)).toBe(`Undone: ${it0.ref}`);
	});

	it('a write that changes nothing is not an undo step', async () => {
		const { b, it0 } = setup('Same');
		echoFetch(b);
		const said = notes(b);
		await b.update(it0.id, 'title', 'Same');
		expect(await b.undo()).toBe(false);
		expect(said.at(-1)).toBe('Nothing to undo');
	});
});

describe('BoardState.remove (delete)', () => {
	function setupTree() {
		const epic = item({}, { type: 'Epic', title: 'Epic', projectId: null });
		const child = item({ 'native:parent': { kind: 'ref', id: epic.id } }, { parentId: epic.id });
		const other = item();
		const reg = registry();
		reg.fields = reg.fields.map((f) => (f.key === 'native:parent' ? { ...f, options: [{ id: epic.id, label: 'Epic', position: 0 }] } : f));
		const data: BoardData = { items: [epic, child, other], registry: reg, fetchedAt: null, stale: false, problem: null, groupLabel: 'g', closedDaysMax: 30 };
		const b = new BoardState(data);
		const said: string[] = [];
		b.notify = (t) => said.push(t);
		const ui = new UiState();
		b.onremove = (id) => ui.forget(id);
		return { b, ui, said, epic, child, other, data };
	}

	it('is not optimistic: the item stays (pending) until GitLab confirms, then it is gone', async () => {
		const calls = stubFetch();
		const { b, ui, said, epic, child } = setupTree();
		ui.open(epic.id);
		const r = b.remove(epic.id);
		expect(calls[0].body).toEqual({ itemId: epic.id });
		expect(b.byId.has(epic.id)).toBe(true);
		expect(b.pending.has(epic.id)).toBe(true);
		calls[0].reply({ status: 200, body: { ok: true } });
		expect(await r).toBe(true);
		flushSync();
		expect(b.byId.has(epic.id)).toBe(false);
		expect(b.pending.has(epic.id)).toBe(false);
		expect(ui.selectedId).toBeNull();
		expect(ui.panelOpen).toBe(false);
		expect(said.at(-1)).toBe(`Deleted ${epic.ref}`);
		// Its sub-item stays, without a parent, and the deleted epic is no longer a parent option.
		expect(b.byId.get(child.id)?.parentId).toBeNull();
		expect(b.byId.get(child.id)?.values['native:parent']).toBeUndefined();
		expect(b.field('native:parent')?.options?.some((o) => o.id === epic.id)).toBe(false);
	});

	it('leaves another selection alone', async () => {
		const calls = stubFetch();
		const { b, ui, other, epic } = setupTree();
		ui.open(other.id);
		const r = b.remove(epic.id);
		calls[0].reply({ status: 200, body: { ok: true } });
		await r;
		expect(ui.selectedId).toBe(other.id);
		expect(ui.panelOpen).toBe(true);
	});

	it('keeps the item and shows the server’s message when the delete fails', async () => {
		const calls = stubFetch();
		const { b, ui, said, other } = setupTree();
		ui.open(other.id);
		const r = b.remove(other.id);
		calls[0].reply({ status: 403, body: { ok: false, error: "You don't have permission to delete this in GitLab." } });
		expect(await r).toBe(false);
		flushSync();
		expect(b.byId.has(other.id)).toBe(true);
		expect(b.pending.has(other.id)).toBe(false);
		expect(ui.selectedId).toBe(other.id);
		expect(said.at(-1)).toBe("You don't have permission to delete this in GitLab.");
	});

	it('is not undoable, and earlier changes to the deleted item leave the undo stack', async () => {
		const { b, said, other, child } = setupTree();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: { body: string }) => {
				const body = JSON.parse(init.body);
				if (url === '/api/items/delete') return { ok: true, status: 200, json: async () => ({ ok: true }) };
				return { ok: true, status: 200, json: async () => ({ ok: true, item: b.byId.get(body.itemId) }) };
			})
		);
		await b.update(child.id, 'title', 'Child renamed');
		await b.update(other.id, 'title', 'Renamed');
		expect(await b.remove(other.id)).toBe(true);
		// Undo skips the deleted item and takes back the change before it.
		expect(await b.undo()).toBe(true);
		expect(said.at(-1)).toBe(`Undone: ${child.ref}`);
		expect(await b.undo()).toBe(false);
		expect(said.at(-1)).toBe('Nothing to undo');
	});

	it('a refresh that was already on its way does not bring a deleted item back', async () => {
		const calls = stubFetch();
		const { b, data, other } = setupTree();
		const r = b.remove(other.id);
		calls[0].reply({ status: 200, body: { ok: true } });
		await r;
		b.setData(data);
		flushSync();
		expect(b.byId.has(other.id)).toBe(false);
	});
});
