import { describe, expect, it, vi } from 'vitest';
import { collectPages } from './load';
import { ALL_CAPABILITIES, SCHEMA_LISTS, schemaPageQuery, schemaQuery } from './queries';

/** A fake connection of `total` nodes served in pages of `size`. */
function fakeList(total: number, size = 100) {
	const page = (start: number) => ({
		nodes: Array.from({ length: Math.min(size, total - start) }, (_, i) => ({ id: `n${start + i}` })),
		pageInfo: { hasNextPage: start + size < total, endCursor: start + size < total ? String(start + size) : null }
	});
	return { first: page(0), next: vi.fn(async (after: string) => page(Number(after))) };
}

describe('schema lists are paginated (review M7)', () => {
	it('loads every member of a 140-member group, not just the first 100', async () => {
		const { first, next } = fakeList(140);
		const r = await collectPages(first, next, 2000);
		expect(r.nodes).toHaveLength(140);
		expect(r.nodes.at(-1)).toEqual({ id: 'n139' });
		expect(r.capped).toBe(false);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it('stops at the cap and says so', async () => {
		const { first, next } = fakeList(5000);
		const r = await collectPages(first, next, 2000);
		expect(r.nodes).toHaveLength(2000);
		expect(r.capped).toBe(true);
	});

	it('does not page a single-page list, and copes with missing pageInfo', async () => {
		const next = vi.fn();
		expect((await collectPages({ nodes: [{ id: 'a' }] }, next, 2000)).nodes).toEqual([{ id: 'a' }]);
		expect((await collectPages(null, next, 2000)).nodes).toEqual([]);
		expect(next).not.toHaveBeenCalled();
	});

	it('never loops forever on a cursor that keeps saying there is more', async () => {
		const stuck = { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'x' } };
		const next = vi.fn(async () => stuck);
		await collectPages(stuck, next, 2000);
		expect(next.mock.calls.length).toBeLessThanOrEqual(200);
	});

	it('every list in the schema query asks for pageInfo, and has a page query', () => {
		const q = schemaQuery(ALL_CAPABILITIES);
		for (const l of SCHEMA_LISTS) {
			expect(q).toMatch(new RegExp(`${l.name}\\([^)]*first: 100\\) \\{\\s*pageInfo \\{ hasNextPage endCursor \\}`));
			expect(schemaPageQuery(l)).toContain('after: $after');
		}
	});
});
