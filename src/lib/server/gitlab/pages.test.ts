import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectPages, fetchConnection } from './load';
import type { ServerConfig } from '../config';
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

describe('work items are loaded up to ITEMS_MAX, and a cut list is reported', () => {
	afterEach(() => vi.unstubAllGlobals());
	const cfg = (itemsMax: number) => ({ gitlabUrl: 'https://gitlab.example.com', group: 'acme', itemsMax }) as ServerConfig;
	const cred = { kind: 'oauth' as const, token: 't' };
	/** A fake GitLab holding `total` items, newest first; records the page sizes asked for. */
	function gitlab(total: number, updatedAt = (_n: number) => '2026-11-01T00:00:00Z') {
		const asked: number[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: { body: string }) => {
				const v = JSON.parse(init.body).variables as { first: number; after: string | null };
				asked.push(v.first);
				const start = v.after ? Number(v.after) : 0;
				const end = Math.min(total, start + v.first);
				const nodes = Array.from({ length: end - start }, (_, i) => ({ id: `gid://gitlab/WorkItem/${start + i}`, updatedAt: updatedAt(start + i) }));
				const body = { data: { group: { workItems: { nodes, pageInfo: { hasNextPage: end < total, endCursor: end < total ? String(end) : null } } } } };
				return { ok: true, status: 200, json: async () => body };
			})
		);
		return asked;
	}

	it('loads all 1,250 items of a group (more than the old 1,000 cut-off)', async () => {
		const asked = gitlab(1250);
		const r = await fetchConnection(cfg(5000), cred, 'q', 'group', 'acme', 'opened', null);
		expect(r.nodes).toHaveLength(1250);
		expect(r.capped).toBe(false);
		expect(asked).toHaveLength(13);
	});

	it('stops at ITEMS_MAX exactly and says the list was cut', async () => {
		const asked = gitlab(1000);
		const r = await fetchConnection(cfg(250), cred, 'q', 'group', 'acme', 'opened', null);
		expect(r.nodes).toHaveLength(250);
		expect(r.capped).toBe(true);
		expect(asked).toEqual([100, 100, 50]);
	});

	it('is not "cut" when the group has exactly ITEMS_MAX items', async () => {
		gitlab(200);
		expect(await fetchConnection(cfg(200), cred, 'q', 'group', 'acme', 'opened', null)).toMatchObject({ capped: false });
	});

	it('closed items stop at the time window without counting as cut', async () => {
		// item n was updated n days before 2026-11-01
		const asked = gitlab(1000, (n) => new Date(Date.UTC(2026, 10, 1) - n * 86_400_000).toISOString());
		const r = await fetchConnection(cfg(5000), cred, 'q', 'group', 'acme', 'closed', Date.UTC(2026, 10, 1) - 150 * 86_400_000);
		expect(asked).toHaveLength(2);
		expect(r.capped).toBe(false);
	});
});
