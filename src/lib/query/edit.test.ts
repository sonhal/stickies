import { describe, expect, it } from 'vitest';
import { addRule, appendProblem, appendRule, combineProblem, combineRuleAt, groupAt, removeRuleAt, setOpAt, toggleOpAt } from './edit';
import { MAX_DEPTH, MAX_RULES, parseView } from './schema';
import { isGroup, type FilterGroup, type FilterRule, type ViewDefinition } from './types';
import { decodeView, encodeView } from '$lib/client/share';
import { defaultViews } from '$lib/views.config';

const rule = (name: string): FilterRule => ({
	field: { name },
	cmp: 'notEmpty'
});
const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(rule);
const and = (...rules: FilterGroup['rules']): FilterGroup => ({
	op: 'and',
	rules
});
const or = (...rules: FilterGroup['rules']): FilterGroup => ({
	op: 'or',
	rules
});

/** Every rule's path, the way the engine reports them. */
function paths(g: FilterGroup, at: number[] = []): number[][] {
	return g.rules.flatMap((r, i) => (isGroup(r) ? paths(r, [...at, i]) : [[...at, i]]));
}

function ruleAt(g: FilterGroup, path: number[]): FilterRule | FilterGroup | undefined {
	return groupAt(g, path.slice(0, -1))?.rules[path[path.length - 1]];
}

const viewWith = (filter: FilterGroup): ViewDefinition => ({
	...defaultViews[0],
	filter
});

describe('combineRuleAt', () => {
	it('turns a rule into an or group with the new rule', () => {
		expect(combineRuleAt(and(a, b), [1], c)).toEqual(and(a, or(b, c)));
	});

	it('appends to the or group the rule is already in', () => {
		expect(combineRuleAt(and(a, or(b, c)), [1, 0], d)).toEqual(and(a, or(b, c, d)));
	});

	it('appends at the top level when the top level is or', () => {
		expect(combineRuleAt(or(a, b), [0], c)).toEqual(or(a, b, c));
	});

	it('does the same for "and" inside an or', () => {
		expect(combineRuleAt(or(a, b), [0], c, 'and')).toEqual(or(and(a, c), b));
		expect(combineRuleAt(and(a, or(b, c)), [1, 1], d, 'and')).toEqual(and(a, or(b, and(c, d))));
	});

	it('leaves the filter alone for a path that leads nowhere', () => {
		const f = and(a, or(b, c));
		expect(combineRuleAt(f, [], d)).toBe(f);
		expect(combineRuleAt(f, [5], d)).toEqual(f);
		expect(combineRuleAt(f, [0, 0], d)).toEqual(f);
	});

	it('does not change the filter it was given', () => {
		const f = and(a, or(b, c));
		const before = JSON.stringify(f);
		combineRuleAt(f, [1, 0], d);
		combineRuleAt(f, [0], d);
		expect(JSON.stringify(f)).toBe(before);
	});
});

describe('appendRule', () => {
	it('appends with the operator of the group', () => {
		expect(appendRule(and(a), b)).toEqual(and(a, b));
		expect(appendRule(or(a, b), c)).toEqual(or(a, b, c));
		expect(appendRule(and(a, or(b, c)), d, [1])).toEqual(and(a, or(b, c, d)));
	});

	it('treats a top level with fewer than two entries as "and"', () => {
		expect(appendRule(or(a), b)).toEqual(and(a, b));
		expect(appendRule(or(), a)).toEqual(and(a));
	});

	it('addRule still narrows an or top level', () => {
		expect(addRule(or(a, b), c)).toEqual(and(or(a, b), c));
	});
});

describe('setOpAt / toggleOpAt', () => {
	it('flips the top level', () => {
		expect(toggleOpAt(and(a, b), [])).toEqual(or(a, b));
		expect(setOpAt(and(a, b), [], 'or')).toEqual(or(a, b));
		const f = and(a, b);
		expect(setOpAt(f, [], 'and')).toBe(f);
	});

	it('flips a nested group and nothing else', () => {
		expect(toggleOpAt(and(a, or(b, c)), [1])).toEqual(and(a, and(b, c)));
		expect(toggleOpAt(and(a, or(b, and(c, d))), [1, 1])).toEqual(and(a, or(b, or(c, d))));
	});

	it('ignores a path that is not a group', () => {
		const f = and(a, or(b, c));
		expect(toggleOpAt(f, [0])).toEqual(f);
		expect(toggleOpAt(f, [7])).toEqual(f);
	});
});

describe('removeRuleAt', () => {
	it('removes a top-level rule', () => {
		expect(removeRuleAt(and(a, b, c), [1])).toEqual(and(a, c));
		expect(removeRuleAt(and(a), [0])).toEqual(and());
	});

	it('collapses a group left with one rule into its parent', () => {
		expect(removeRuleAt(and(a, or(b, c)), [1, 0])).toEqual(and(a, c));
		expect(removeRuleAt(and(a, or(b, c, d)), [1, 0])).toEqual(and(a, or(c, d)));
	});

	it('drops a group left empty', () => {
		expect(removeRuleAt(and(a, or(b)), [1, 0])).toEqual(and(a));
		expect(removeRuleAt(and(a, or(and(b), c)), [1, 0, 0])).toEqual(and(a, c));
	});

	it('merges a leftover group into a parent with the same operator', () => {
		expect(removeRuleAt(and(a, or(b, and(c, d))), [1, 0])).toEqual(and(a, c, d));
	});

	it('lifts a single remaining group to the top level', () => {
		expect(removeRuleAt(and(a, or(b, c)), [0])).toEqual(or(b, c));
	});

	it('resets an or top level with one rule left to "and"', () => {
		expect(removeRuleAt(or(a, b), [1])).toEqual(and(a));
	});

	it('removes a whole group by its path', () => {
		expect(removeRuleAt(and(a, or(b, c), d), [1])).toEqual(and(a, d));
	});

	it('keeps other groups as they are', () => {
		expect(removeRuleAt(and(or(a, b), or(c, d), e), [2])).toEqual(and(or(a, b), or(c, d)));
	});
});

describe('paths stay valid', () => {
	it('every rule is reachable after each kind of change, and none is lost', () => {
		const start = and(a, or(b, c), d);
		const steps: FilterGroup[] = [
			combineRuleAt(start, [0], e),
			combineRuleAt(start, [1, 1], e),
			combineRuleAt(start, [1, 1], e, 'and'),
			toggleOpAt(start, [1]),
			removeRuleAt(start, [1, 0]),
			removeRuleAt(start, [0])
		];
		for (const f of steps) {
			for (const p of paths(f)) {
				const r = ruleAt(f, p);
				expect(r && !isGroup(r)).toBe(true);
				// Removing by a reported path removes exactly that rule
				expect(paths(removeRuleAt(f, p)).length).toBe(paths(f).length - 1);
			}
		}
		expect(paths(steps[0])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [2]]);
	});

	it('removing every rule one by one ends with an empty "and"', () => {
		let f = and(or(a, and(b, c)), or(d, e));
		while (paths(f).length) f = removeRuleAt(f, paths(f)[0]);
		expect(f).toEqual(and());
	});
});

describe('limits', () => {
	const many = (n: number) => Array.from({ length: n }, (_, i) => rule(`r${i}`));

	it('refuses a rule past the maximum', () => {
		expect(appendProblem(and(...many(MAX_RULES - 1)))).toBeNull();
		const full = and(...many(MAX_RULES - 2), or(a, b));
		expect(appendProblem(full)).toMatch(/at most 40/);
		expect(combineProblem(full, [0])).toMatch(/at most 40/);
		expect(parseView(viewWith(appendRule(full, c))).ok).toBe(false);
	});

	it('refuses a group below the deepest level, but still lets a rule join its own group', () => {
		// Depth 4: and > or > and > or
		const deep = and(a, or(b, and(c, or(d, e))));
		expect(parseView(viewWith(deep)).ok).toBe(true);
		expect(combineProblem(deep, [1, 1, 1, 0], 'and')).toMatch(/deeper/);
		expect(parseView(viewWith(combineRuleAt(deep, [1, 1, 1, 0], a, 'and'))).ok).toBe(false);
		expect(combineProblem(deep, [1, 1, 1, 0], 'or')).toBeNull();
		expect(parseView(viewWith(combineRuleAt(deep, [1, 1, 1, 0], a, 'or'))).ok).toBe(true);
		// One level up there is still room for a new group
		expect(combineProblem(deep, [1, 1, 0], 'or')).toBeNull();
		expect(parseView(viewWith(combineRuleAt(deep, [1, 1, 0], a, 'or'))).ok).toBe(true);
		expect(MAX_DEPTH).toBe(4);
	});

	it('reports a path that no longer exists', () => {
		expect(combineProblem(and(a), [3])).not.toBeNull();
		expect(combineProblem(and(a), [])).not.toBeNull();
	});
});

describe('a view with an or group', () => {
	it('survives parseView and the share link round trip', () => {
		const triage = defaultViews.find((v) => v.id === 'triage')!;
		const edited = viewWith(combineRuleAt(toggleOpAt(combineRuleAt(triage.filter, [0], a), []), [1, 0], b, 'and'));
		const parsed = parseView(JSON.parse(JSON.stringify(edited)));
		expect(parsed.ok && parsed.view.filter).toEqual(edited.filter);
		expect(decodeView(encodeView(edited))?.filter).toEqual(edited.filter);
		expect(decodeView(encodeView(triage))?.filter).toEqual(triage.filter);
	});
});
