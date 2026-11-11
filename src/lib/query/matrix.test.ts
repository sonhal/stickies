import { describe, expect, it } from 'vitest';
import { registry, selectField, item, opt, num, date } from '$lib/testing/factory';
import { groupByQuadrant, halfCut, placeItems, quadrantCells, resolveAxis, screenLayout } from './matrix';
import type { RankContext } from './rank';
import type { AxisConfig } from './types';
import type { FieldDef } from '$lib/fields/types';

function ctx(fields: FieldDef[], extra: Partial<RankContext> = {}): RankContext {
	return { reg: registry(fields), fieldSettings: [], defaultDirection: 'firstHighest', ...extra };
}

/** Which options land in the high half, with default settings (first = highest). */
function highOptions(labels: string[], axis: Partial<AxisConfig> = {}): string[] {
	const f = selectField('custom:1', 'F', labels);
	const a = resolveAxis({ field: { name: 'F' }, ...axis }, ctx([f]), []);
	return f.options!.filter((o) => a.read(item({ 'custom:1': opt(o.id) }))!.high).map((o) => o.label);
}

describe('matrix split', () => {
	it('splits 2, 3, 4 and 7 options in half (odd middle goes high)', () => {
		expect(highOptions(['A', 'B'])).toEqual(['A']);
		expect(highOptions(['A', 'B', 'C'])).toEqual(['A', 'B']);
		expect(highOptions(['A', 'B', 'C', 'D'])).toEqual(['A', 'B']);
		expect(highOptions(['1', '2', '3', '4', '5', '6', '7'])).toEqual(['1', '2', '3', '4']);
	});

	it('can send the odd middle low', () => {
		expect(highOptions(['A', 'B', 'C'], { oddMiddle: 'low' })).toEqual(['A']);
		expect(highOptions(['1', '2', '3', '4', '5', '6', '7'], { oddMiddle: 'low' })).toEqual(['1', '2', '3']);
		expect(halfCut(1)).toBe(0);
	});

	it('honors rank direction (first option = lowest)', () => {
		expect(highOptions(['Low', 'Medium', 'High', 'Critical'], { rankDirection: 'firstLowest' })).toEqual([
			'High',
			'Critical'
		]);
	});

	it('splits at an explicit option, by label or id', () => {
		expect(highOptions(['Critical', 'High', 'Medium', 'Low'], { split: { atOption: 'Critical' } })).toEqual(['Critical']);
		expect(highOptions(['Critical', 'High', 'Medium', 'Low'], { split: { atOption: 'medium' } })).toEqual([
			'Critical',
			'High',
			'Medium'
		]);
	});

	it('falls back to half with a warning when the split option is gone', () => {
		const f = selectField('custom:1', 'F', ['A', 'B', 'C', 'D']);
		const a = resolveAxis({ field: { name: 'F' }, split: { atOption: 'Gone' } }, ctx([f]), []);
		expect(a.warning).toMatch(/no longer exists/);
		expect(highOptions(['A', 'B', 'C', 'D'], { split: { atOption: 'Gone' } })).toEqual(['A', 'B']);
	});

	it('uses the per-field rank setting when the axis has none', () => {
		const f = selectField('custom:1', 'Effort', ['S', 'M', 'L']);
		const c = ctx([f], { fieldSettings: [{ field: { name: 'effort' }, rankDirection: 'firstLowest' }] });
		const a = resolveAxis({ field: { name: 'Effort' } }, c, []);
		expect(a.read(item({ 'custom:1': opt(f.options![2].id) }))!.high).toBe(true);
		expect(a.read(item({ 'custom:1': opt(f.options![0].id) }))!.high).toBe(false);
	});
});

describe('axes by field kind', () => {
	it('numbers use a threshold', () => {
		const a = resolveAxis({ field: { field: 'native:weight' }, split: { threshold: 3 } }, ctx([]), []);
		expect(a.read(item({ 'native:weight': num(3) }))!.high).toBe(true);
		expect(a.read(item({ 'native:weight': num(2) }))!.high).toBe(false);
		expect(a.read(item({}))).toBeNull();
	});

	it('dates are high when due within N days', () => {
		const now = new Date('2026-11-09T12:00:00Z');
		const a = resolveAxis({ field: { field: 'native:dueDate' }, split: { withinDays: 7 } }, ctx([]), [], now);
		expect(a.read(item({ 'native:dueDate': date('2026-11-01') }))!.high).toBe(true);
		expect(a.read(item({ 'native:dueDate': date('2026-11-16') }))!.high).toBe(true);
		expect(a.read(item({ 'native:dueDate': date('2026-11-17') }))!.high).toBe(false);
	});

	it('a removed field puts everything in triage with a problem, never throws', () => {
		const a = resolveAxis({ field: { name: 'Priority' } }, ctx([]), []);
		expect(a.problem).toMatch(/no longer exists/);
		const { placed, unplaced } = placeItems([item()], a, a);
		expect(placed).toHaveLength(0);
		expect(unplaced[0].missing).toEqual(['x', 'y']);
	});

	it('a removed option on an item counts as missing', () => {
		const f = selectField('custom:1', 'F', ['A', 'B']);
		const a = resolveAxis({ field: { name: 'F' } }, ctx([f]), []);
		expect(a.read(item({ 'custom:1': opt('deleted') }))).toBeNull();
	});
});

describe('placement', () => {
	const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low']);
	const c = ctx([prio]);
	const x = resolveAxis({ field: { field: 'native:weight' }, split: { threshold: 3 } }, c, []);
	const y = resolveAxis({ field: { name: 'Priority' }, split: { atOption: 'High' } }, c, []);
	const P = (label: string) => opt(prio.options!.find((o) => o.label === label)!.id);

	it('puts items in quadrants and incomplete ones in triage', () => {
		const doIt = item({ 'native:weight': num(5), 'custom:7': P('Critical') });
		const schedule = item({ 'native:weight': num(1), 'custom:7': P('High') });
		const delegate = item({ 'native:weight': num(3), 'custom:7': P('Medium') });
		const drop = item({ 'native:weight': num(0), 'custom:7': P('Low') });
		const noWeight = item({ 'custom:7': P('High') });
		const { placed, unplaced } = placeItems([doIt, schedule, delegate, drop, noWeight], x, y);
		const q = Object.fromEntries(placed.map((p) => [p.item.id, p.quadrant]));
		expect(q[doIt.id]).toBe('highHigh');
		expect(q[schedule.id]).toBe('lowHigh');
		expect(q[delegate.id]).toBe('highLow');
		expect(q[drop.id]).toBe('lowLow');
		expect(unplaced.map((u) => [u.item.id, u.missing])).toEqual([[noWeight.id, ['x']]]);
	});

	it('sorts most important, then most urgent, then by number', () => {
		const a = item({ 'native:weight': num(3), 'custom:7': P('High') });
		const b = item({ 'native:weight': num(5), 'custom:7': P('Critical') });
		const cc = item({ 'native:weight': num(5), 'custom:7': P('High') });
		const { placed } = placeItems([a, b, cc], x, y);
		expect(groupByQuadrant(placed).highHigh.map((p) => p.item.id)).toEqual([b.id, cc.id, a.id]);
	});

	it('puts Do top-right and honors invert', () => {
		expect(screenLayout(x, y).cells).toEqual([
			['lowHigh', 'highHigh'],
			['lowLow', 'highLow']
		]);
		const xi = { ...x, config: { ...x.config, invert: true } };
		expect(screenLayout(xi, y).cells[0]).toEqual(['highHigh', 'lowHigh']);
	});
});

describe('quadrantCells: position inside a quadrant (higher x right, higher y up)', () => {
	const P = (x: number, y: number, id = `${x}-${y}-${Math.random()}`) =>
		({ item: { id, iid: 1 } as never, x, y, quadrant: 'highHigh' as const });

	it('puts higher x to the right and higher y on top, using only positions with items', () => {
		const a = P(1, 1, 'a'), b = P(2, 1, 'b'), c = P(1, 3, 'c'), d = P(1, 3, 'd');
		const g = quadrantCells([a, b, c, d]);
		expect(g.cols).toBe(2);
		expect(g.rows).toBe(2); // y = 1 and 3; nothing at 2, so no empty row
		const at = (id: string) => g.cells.find((cell) => cell.items.some((p) => p.item.id === id))!;
		expect([at('c').row, at('c').col]).toEqual([1, 1]); // high y → top
		expect([at('a').row, at('a').col]).toEqual([2, 1]);
		expect([at('b').row, at('b').col]).toEqual([2, 2]); // high x → right
		expect(at('c').items.map((p) => p.item.id)).toEqual(['c', 'd']); // same values stack, order kept
	});

	it('flips with inverted axes', () => {
		const g = quadrantCells([P(1, 1, 'lo'), P(2, 2, 'hi')], { invertX: true, invertY: true });
		const hi = g.cells.find((c) => c.items[0].item.id === 'hi')!;
		expect([hi.row, hi.col]).toEqual([2, 1]); // high y at the bottom, high x on the left
	});

	it('merges many distinct numeric values into at most 4 columns, keeping order', () => {
		const xs = [3, 4, 5, 8, 13, 21];
		const g = quadrantCells(xs.map((x) => P(x, 1, `w${x}`)));
		expect(g.cols).toBeLessThanOrEqual(4);
		const col = (x: number) => g.cells.find((c) => c.items.some((p) => p.item.id === `w${x}`))!.col;
		for (let i = 1; i < xs.length; i++) expect(col(xs[i])).toBeGreaterThanOrEqual(col(xs[i - 1]));
		expect(col(21)).toBeGreaterThan(col(3));
	});

	it('handles an empty quadrant and a single item', () => {
		expect(quadrantCells([])).toEqual({ cols: 0, rows: 0, cells: [] });
		expect(quadrantCells([P(5, 5)]).cells[0]).toMatchObject({ row: 1, col: 1 });
	});
});
