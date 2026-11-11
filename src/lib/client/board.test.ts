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
