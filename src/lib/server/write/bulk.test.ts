import { describe, expect, it } from 'vitest';
import { registry, selectField, item, many } from '$lib/testing/factory';
import { BULK_MAX, planBulk } from './validate';
import { RateLimiter } from './ratelimit';
import { pool } from './execute';

const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low'], { appliesTo: ['Issue'] });
const reg = registry([prio]);
const epic = item({}, { id: 'gid://gitlab/WorkItem/900', type: 'Epic', ref: 'g&900' });
const i1 = item({ 'native:labels': many('l-bug') }, { id: 'gid://gitlab/WorkItem/1', ref: 'g/api#1' });
const i2 = item({}, { id: 'gid://gitlab/WorkItem/2', ref: 'g/api#2' });
const items = [epic, i1, i2];
const high = prio.options![1].id;

describe('planBulk', () => {
	it('plans one allowlisted update per item, each with its own value', () => {
		const r = planBulk({ field: 'native:labels', changes: [{ itemId: i1.id, value: ['l-bug', 'l-be'] }, { itemId: i2.id, value: ['l-be'] }] }, reg, items);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.plans.map((p) => p.input)).toEqual([
			{ id: i1.id, labelsWidget: { addLabelIds: ['l-be'], removeLabelIds: [] } },
			{ id: i2.id, labelsWidget: { addLabelIds: ['l-be'], removeLabelIds: [] } }
		]);
	});

	it('refuses the whole request when one change is invalid, naming the item', () => {
		const r = planBulk({ field: 'custom:7', changes: [{ itemId: i1.id, value: high }, { itemId: epic.id, value: high }] }, reg, items);
		expect(r).toMatchObject({ ok: false, status: 400 });
		expect(!r.ok && r.error).toBe("g&900: Priority doesn't apply to a Epic");
		const missing = planBulk({ field: 'custom:7', changes: [{ itemId: 'gid://gitlab/WorkItem/424242', value: high }] }, reg, items);
		expect(missing).toMatchObject({ ok: false, status: 404 });
	});

	it('refuses titles, descriptions, duplicates, empty and oversized requests', () => {
		expect(planBulk({ field: 'title', changes: [{ itemId: i1.id, value: 'x' }] }, reg, items)).toMatchObject({ ok: false, error: /Titles/ });
		expect(planBulk({ field: 'description', changes: [{ itemId: i1.id, value: 'x' }] }, reg, items)).toMatchObject({ ok: false });
		expect(planBulk({ field: 'custom:7', changes: [{ itemId: i1.id, value: high }, { itemId: i1.id, value: high }] }, reg, items)).toMatchObject({
			ok: false,
			error: /twice/
		});
		expect(planBulk({ field: 'custom:7', changes: [] }, reg, items)).toMatchObject({ ok: false });
		const tooMany = Array.from({ length: BULK_MAX + 1 }, (_, n) => ({ itemId: `gid://gitlab/WorkItem/${n + 1}`, value: high }));
		expect(planBulk({ field: 'custom:7', changes: tooMany }, reg, items)).toMatchObject({ ok: false, error: 'Invalid request' });
	});

	it('refuses smuggled extra keys like a single edit does', () => {
		expect(planBulk({ field: 'custom:7', changes: [{ itemId: i1.id, value: high }], query: 'mutation { x }' }, reg, items)).toMatchObject({ ok: false });
		expect(planBulk({ field: 'custom:7', changes: [{ itemId: i1.id, value: high, baseVersion: 'a'.repeat(64) }] }, reg, items)).toMatchObject({ ok: false });
	});
});

describe('RateLimiter.take(n)', () => {
	it('takes all n hits or none', () => {
		const r = new RateLimiter(10);
		expect(r.take('u', 0, 8)).toBe(true);
		expect(r.remaining('u', 0)).toBe(2);
		expect(r.take('u', 0, 3)).toBe(false);
		expect(r.remaining('u', 0)).toBe(2); // nothing taken by the refused request
		expect(r.take('u', 0, 2)).toBe(true);
		expect(r.take('u', 0)).toBe(false);
		expect(r.remaining('u', 60_001)).toBe(10);
	});
});

describe('pool', () => {
	it('keeps order and never runs more than the limit at once', async () => {
		let running = 0;
		let peak = 0;
		const out = await pool([5, 1, 4, 2, 3], 2, async (n) => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, n));
			running--;
			return n * 10;
		});
		expect(out).toEqual([50, 10, 40, 20, 30]);
		expect(peak).toBe(2);
	});
});
