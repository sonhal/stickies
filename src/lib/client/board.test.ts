/**
 * Optimistic writes with responses that arrive out of order (review M3).
 * fetch is replaced by a stub whose responses we resolve by hand, in any order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { BoardState } from './board.svelte';
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
