import { describe, expect, it } from 'vitest';
import { parseView, parseViewList } from './schema';
import { defaultViews } from '$lib/views.config';
import { runView } from './engine';
import { registry, item } from '$lib/testing/factory';

const valid = {
	version: 1,
	id: 'mine',
	name: 'Mine',
	layout: 'list',
	filter: { op: 'and', rules: [{ field: { field: 'native:assignees' }, cmp: 'anyOf', value: ['me'] }] },
	orderBy: [{ field: { name: 'Priority' }, dir: 'desc' }],
	display: { properties: [{ name: 'Priority' }], subIssues: 'nested', showEmptyGroups: false, completed: 'week' }
};

describe('parseView', () => {
	it('accepts every default view in views.config.ts', () => {
		for (const v of defaultViews) {
			const r = parseView(v);
			expect(r.ok, `${v.id}: ${!r.ok && r.error}`).toBe(true);
		}
		expect(new Set(defaultViews.map((v) => v.id)).size).toBe(defaultViews.length);
	});

	it('opens an old matrix view as a list and marks it, dropping the matrix config', () => {
		const old = { ...valid, layout: 'matrix', matrix: { x: { field: { field: 'native:weight' } }, y: { field: { name: 'Priority' } } } };
		const r = parseView(old);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.view.layout).toBe('list');
		expect(r.view.migrated).toBe('matrixLayout');
		expect('matrix' in r.view).toBe(false);
	});

	it('does not accept a made-up migration marker', () => {
		expect(parseView({ ...valid, migrated: 'anything else' }).ok).toBe(false);
	});

	it('accepts a valid view and migrates a missing version', () => {
		expect(parseView(valid).ok).toBe(true);
		const { version: _v, ...noVersion } = valid;
		expect(parseView(noVersion).ok).toBe(true);
	});

	it('rejects bad input with a reason', () => {
		const bad: unknown[] = [
			null,
			42,
			'view',
			[],
			{ ...valid, version: 2 },
			{ ...valid, id: '../../etc' },
			{ ...valid, name: '' },
			{ ...valid, layout: 'gantt' },
			{ ...valid, filter: { op: 'xor', rules: [] } },
			{ ...valid, filter: { op: 'and', rules: [{ field: {}, cmp: 'is' }] } },
			{ ...valid, filter: { op: 'and', rules: [{ field: { field: 'javascript:alert(1)' }, cmp: 'is' }] } },
			{ ...valid, filter: { op: 'and', rules: [{ field: { name: 'x' }, cmp: 'regex', value: '.*' }] } },
			{ ...valid, display: { ...valid.display, completed: 'forever' } },
			{ ...valid, name: 'x'.repeat(1000) }
		];
		for (const b of bad) expect(parseView(b).ok, JSON.stringify(b)?.slice(0, 80)).toBe(false);
	});

	it('limits filter depth and size', () => {
		let g: unknown = { op: 'and', rules: [] };
		for (let i = 0; i < 8; i++) g = { op: 'and', rules: [g] };
		expect(parseView({ ...valid, filter: g }).ok).toBe(false);
		const many = { op: 'and', rules: Array.from({ length: 41 }, () => ({ field: { name: 'a' }, cmp: 'empty' })) };
		expect(parseView({ ...valid, filter: many }).ok).toBe(false);
	});

	it('drops unknown keys (nothing extra reaches the UI)', () => {
		const r = parseView({ ...valid, evil: '<script>' });
		expect(r.ok && 'evil' in r.view).toBe(false);
	});

	it('skips corrupt entries in a list and dedupes ids', () => {
		const r = parseViewList([valid, { nope: 1 }, valid, { ...valid, id: 'other' }]);
		expect(r.views.map((v) => v.id)).toEqual(['mine', 'other']);
		expect(r.skipped).toBe(2);
		expect(parseViewList('garbage').views).toEqual([]);
	});
});

/** Small deterministic PRNG so failures reproduce. */
function prng(seed: number) {
	return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

function randomJson(rnd: () => number, depth = 0): unknown {
	const r = rnd();
	if (depth > 4 || r < 0.2) {
		const leaves = [null, true, false, 0, -1, 1e308, NaN, '', 'me', 'native:status', 'custom:7', 'Priority', '__proto__', '<img src=x>', 'today+3'];
		return leaves[Math.floor(rnd() * leaves.length)];
	}
	if (r < 0.5) return Array.from({ length: Math.floor(rnd() * 4) }, () => randomJson(rnd, depth + 1));
	const keys = ['version', 'id', 'name', 'layout', 'filter', 'op', 'rules', 'field', 'cmp', 'value', 'display', 'orderBy', 'groupBy', 'matrix', 'x', 'y', 'split', 'atOption', 'properties', 'completed', '__proto__', 'constructor'];
	const o: Record<string, unknown> = {};
	for (let i = 0; i < Math.floor(rnd() * 6); i++) o[keys[Math.floor(rnd() * keys.length)]] = randomJson(rnd, depth + 1);
	return o;
}

/** Mutate a valid view in one random place, so the fuzzer also explores near-valid input. */
function mutate(rnd: () => number): unknown {
	const v = JSON.parse(JSON.stringify(valid));
	const paths: [string[], unknown][] = [
		[['filter', 'rules'], randomJson(rnd)],
		[['filter', 'op'], randomJson(rnd)],
		[['display'], randomJson(rnd)],
		[['orderBy'], randomJson(rnd)],
		[['groupBy'], randomJson(rnd)],
		[['matrix'], { x: { field: randomJson(rnd) }, y: { field: { name: 'P' }, split: randomJson(rnd) } }]
	];
	const [path, val] = paths[Math.floor(rnd() * paths.length)];
	let o = v;
	for (const k of path.slice(0, -1)) o = o[k];
	o[path[path.length - 1]] = val;
	return v;
}

describe('fuzz: random JSON never crashes the parser or the engine', () => {
	it('survives 3000 random inputs', () => {
		const rnd = prng(42);
		const reg = registry();
		const items = [item(), item({ 'native:weight': { kind: 'number', value: 3 } })];
		let accepted = 0;
		for (let n = 0; n < 3000; n++) {
			const input = n % 2 ? randomJson(rnd) : mutate(rnd);
			const r = parseView(input);
			if (r.ok) {
				accepted++;
				// Whatever the parser accepts, the engine must run without throwing.
				expect(() => runView(items, r.view, { rank: { reg, fieldSettings: [], defaultDirection: 'firstHighest' }, now: new Date(), closedDaysMax: 30 })).not.toThrow();
			}
			expect(() => parseViewList([input, input])).not.toThrow();
		}
		expect(accepted).toBeGreaterThan(0);
	});
});
