import { describe, expect, it } from 'vitest';
import { prioritizationTools } from '$lib/prioritization.config';
import { defaultViews } from '$lib/views.config';
import { parseView } from '$lib/query/schema';
import { DEFAULT_QUADRANTS, placeItems, quadrantsOf, resolveAxis, screenLayout, walkOrderOf } from '$lib/query/matrix';
import { item, num, opt, registry, selectField } from '$lib/testing/factory';
import { defineTools, TOOL_TYPES, toolType, toView } from './tools';
import type { ToolInstance } from './types';


describe('prioritization config', () => {
	it('every instance has a known type and a unique id, also unique against view ids', () => {
		const ids = prioritizationTools.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const t of prioritizationTools) expect(TOOL_TYPES[t.type], t.id).toBeDefined();
		// KIOSK_VIEWS mixes view ids and tool ids, so they must not collide
		const viewIds = new Set(defaultViews.map((v) => v.id));
		expect(ids.filter((id) => viewIds.has(id))).toEqual([]);
	});

	it('the filter of every instance is a valid view filter', () => {
		for (const t of prioritizationTools) {
			const { matrix: _m, layout: _l, ...rest } = toView(t);
			const r = parseView({ ...rest, id: t.id, layout: 'list' });
			expect(r.ok, `${t.id}: ${!r.ok && r.error}`).toBe(true);
		}
	});

	it('no default view uses the matrix layout any more', () => {
		expect(defaultViews.filter((v) => v.layout === 'matrix').map((v) => v.id)).toEqual([]);
	});

	it('rejects duplicate ids', () => {
		const t = prioritizationTools[0];
		expect(() => defineTools([t, t])).toThrow(/Duplicate/);
	});
});

describe('tool types', () => {
	const eis: ToolInstance = {
		id: 'e',
		name: 'E',
		type: 'eisenhower',
		filter: { op: 'and', rules: [] },
		urgency: { field: { field: 'native:weight' }, split: { threshold: 3 } },
		importance: { field: { name: 'Priority' } }
	};
	const ve: ToolInstance = {
		id: 'v',
		name: 'V',
		type: 'valueEffort',
		filter: { op: 'and', rules: [] },
		value: { field: { name: 'Priority' } },
		effort: { field: { name: 'Effort' }, title: 'Size' }
	};

	it('Eisenhower: urgency is x, importance is y, with Do/Schedule/Delegate/Drop', () => {
		const m = toolType(eis).toMatrix(eis as never);
		expect(m.x.field).toEqual({ field: 'native:weight' });
		expect(m.x.title).toBe('Urgency');
		expect(m.y.title).toBe('Importance');
		expect(m.label).toBe('Eisenhower matrix');
		expect(quadrantsOf(m)).toEqual(DEFAULT_QUADRANTS);
	});

	it('Value vs effort: small effort on the left, quick wins top-left, config overrides defaults', () => {
		const m = toolType(ve).toMatrix(ve as never);
		expect(m.x.invert).toBeFalsy();
		expect(m.x.title).toBe('Size'); // instance value wins over the type default
		expect(quadrantsOf(m).lowHigh.name).toBe('Quick wins');
	});

	it('Value vs effort draws Quick wins top-left and Small effort on the left', () => {
		const effort = selectField('custom:8', 'Effort', ['Large', 'Medium', 'Small']);
		const prio = selectField('custom:7', 'Priority', ['High', 'Low']);
		const ctx = { reg: registry([effort, prio]), fieldSettings: [], defaultDirection: 'firstHighest' as const };
		const inst: ToolInstance = { ...ve, effort: { field: { name: 'Effort' } } };
		const m = toolType(inst).toMatrix(inst as never);
		const layout = screenLayout(resolveAxis(m.x, ctx, []), resolveAxis(m.y, ctx, []));
		expect(layout.cells[0][0]).toBe('lowHigh'); // top-left
		expect(quadrantsOf(m)[layout.cells[0][0]].name).toBe('Quick wins');
		expect(layout.xCaptions).toEqual(['Small', 'Large']);
		expect(walkOrderOf(m)[0]).toBe('lowHigh'); // the walk-through starts with Quick wins
	});

	it('walk order defaults to Eisenhower and never drops or repeats a quadrant', () => {
		expect(walkOrderOf({ x: { field: {} }, y: { field: {} } })).toEqual(['highHigh', 'lowHigh', 'highLow', 'lowLow']);
		const odd = walkOrderOf({ x: { field: {} }, y: { field: {} }, walkOrder: ['lowLow', 'lowLow', 'nope' as never] });
		expect(odd).toEqual(['lowLow', 'highHigh', 'lowHigh', 'highLow']);
	});

	it('toView builds an internal matrix view that a user view could never be', () => {
		const v = toView(eis);
		expect(v.layout).toBe('matrix');
		expect(v.id).toBe('p:e');
		// The id is deliberately not a valid view id, so it can never be saved or shared as a view
		expect(parseView(v).ok).toBe(false);
		// and with a valid id, the matrix layout would still be turned into a list
		const r = parseView({ ...v, id: 'e' });
		expect(r.ok && r.view.layout).toBe('list');
	});

	it('places items into Eisenhower quadrants end to end', () => {
		const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low']);
		const P = (l: string) => opt(prio.options!.find((o) => o.label === l)!.id);
		const ctx = { reg: registry([prio, { key: 'native:weight', name: 'Weight', kind: 'number', ordered: true, editable: true, appliesTo: [] }]), fieldSettings: [], defaultDirection: 'firstHighest' as const };
		const m = toolType(eis).toMatrix(eis as never);
		const doIt = item({ 'custom:7': P('Critical'), 'native:weight': num(5) });
		const drop = item({ 'custom:7': P('Low'), 'native:weight': num(1) });
		const items = [doIt, drop];
		const placed = placeItems(items, resolveAxis(m.x, ctx, items), resolveAxis(m.y, ctx, items)).placed;
		expect(placed.find((p) => p.item.id === doIt.id)!.quadrant).toBe('highHigh');
		expect(placed.find((p) => p.item.id === drop.id)!.quadrant).toBe('lowLow');
	});
});
