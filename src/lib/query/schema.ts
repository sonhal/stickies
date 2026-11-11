/**
 * View validation. Every view is checked with this schema whenever it is loaded: from
 * views.config.ts (tests), localStorage, a share link (?v=) or an imported JSON file.
 * Anything that doesn't fit is rejected (or, for a list, skipped) instead of reaching the UI.
 */
import * as v from 'valibot';
import { CMPS, type FilterGroup, type ViewDefinition } from './types';

const MAX_RULES = 40;
const MAX_DEPTH = 4;

const Str = (max: number) => v.pipe(v.string(), v.maxLength(max));
const Id = v.pipe(v.string(), v.minLength(1), v.maxLength(64), v.regex(/^[A-Za-z0-9_-]+$/));

const FieldRefSchema = v.pipe(
	v.object({
		field: v.optional(v.pipe(v.string(), v.maxLength(80), v.regex(/^(native|custom):[A-Za-z0-9_-]+$/))),
		name: v.optional(Str(120))
	}),
	v.check((r) => !!(r.field || r.name), 'A field reference needs a field key or a name')
);

const FilterValueSchema = v.union([Str(200), v.pipe(v.number(), v.finite()), v.pipe(v.array(Str(200)), v.maxLength(50))]);

const FilterRuleSchema = v.object({
	field: FieldRefSchema,
	cmp: v.picklist(CMPS),
	value: v.optional(FilterValueSchema)
});

const FilterGroupSchema: v.GenericSchema<FilterGroup> = v.object({
	op: v.picklist(['and', 'or']),
	rules: v.pipe(
		v.array(v.union([FilterRuleSchema, v.lazy(() => FilterGroupSchema)])),
		v.maxLength(MAX_RULES)
	)
});

const SplitSchema = v.union([
	v.literal('half'),
	v.object({ atOption: Str(200) }),
	v.object({ threshold: v.pipe(v.number(), v.finite()) }),
	v.object({ withinDays: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3650)) })
]);

const RankSchema = v.picklist(['firstHighest', 'firstLowest']);

const AxisSchema = v.object({
	field: FieldRefSchema,
	split: v.optional(SplitSchema),
	rankDirection: v.optional(RankSchema),
	oddMiddle: v.optional(v.picklist(['high', 'low'])),
	title: v.optional(Str(60)),
	lowLabel: v.optional(Str(60)),
	highLabel: v.optional(Str(60)),
	invert: v.optional(v.boolean())
});

const QuadrantSchema = v.object({ name: Str(40), hint: Str(80) });

const ViewSchema = v.object({
	version: v.literal(1),
	id: Id,
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	description: v.optional(Str(300)),
	scope: v.optional(
		v.object({
			projects: v.optional(v.pipe(v.array(Str(300)), v.maxLength(50))),
			epics: v.optional(v.pipe(v.array(Str(120)), v.maxLength(50)))
		})
	),
	filter: FilterGroupSchema,
	layout: v.picklist(['list', 'board', 'matrix']),
	groupBy: v.optional(v.nullable(FieldRefSchema)),
	subGroupBy: v.optional(v.nullable(FieldRefSchema)),
	orderBy: v.pipe(
		v.array(v.object({ field: v.union([v.literal('manual'), FieldRefSchema]), dir: v.picklist(['asc', 'desc']) })),
		v.maxLength(5)
	),
	display: v.object({
		properties: v.pipe(v.array(FieldRefSchema), v.maxLength(30)),
		subIssues: v.picklist(['nested', 'flat', 'hidden']),
		showEmptyGroups: v.boolean(),
		completed: v.picklist(['all', 'day', 'week', 'month', 'none'])
	}),
	matrix: v.optional(
		v.object({
			x: AxisSchema,
			y: AxisSchema,
			quadrants: v.optional(
				v.object({
					highHigh: v.optional(QuadrantSchema),
					lowHigh: v.optional(QuadrantSchema),
					highLow: v.optional(QuadrantSchema),
					lowLow: v.optional(QuadrantSchema)
				})
			)
		})
	),
	rankDirection: v.optional(RankSchema)
});

function depth(g: FilterGroup, d = 1): number {
	let max = d;
	for (const r of g.rules) if ('op' in r) max = Math.max(max, depth(r, d + 1));
	return max;
}

function countRules(g: FilterGroup): number {
	return g.rules.reduce((n, r) => n + ('op' in r ? countRules(r) : 1), 0);
}

/**
 * Bring an older stored view up to the current version. Only version 1 exists so far;
 * a view without a version is treated as version 1.
 */
export function migrateView(raw: unknown): unknown {
	if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('version' in raw)) return { ...raw, version: 1 };
	return raw;
}

export type ParseResult = { ok: true; view: ViewDefinition } | { ok: false; error: string };

export function parseView(raw: unknown): ParseResult {
	let input: unknown;
	try {
		input = migrateView(raw);
	} catch {
		return { ok: false, error: 'Not a view' };
	}
	const res = v.safeParse(ViewSchema, input);
	if (!res.success) {
		const first = res.issues[0];
		const where = first.path?.map((p) => String(p.key)).join('.') ?? '';
		return { ok: false, error: `${where ? where + ': ' : ''}${first.message}` };
	}
	const view = res.output as ViewDefinition;
	if (depth(view.filter) > MAX_DEPTH) return { ok: false, error: 'Filter is nested too deeply' };
	if (countRules(view.filter) > MAX_RULES) return { ok: false, error: 'Too many filter rules' };
	return { ok: true, view };
}

/** Parse a list of views (localStorage, import), skipping bad entries. */
export function parseViewList(raw: unknown): { views: ViewDefinition[]; skipped: number } {
	if (!Array.isArray(raw)) return { views: [], skipped: raw === null || raw === undefined ? 0 : 1 };
	const views: ViewDefinition[] = [];
	let skipped = 0;
	const ids = new Set<string>();
	for (const entry of raw.slice(0, 200)) {
		const r = parseView(entry);
		if (r.ok && !ids.has(r.view.id)) {
			views.push(r.view);
			ids.add(r.view.id);
		} else skipped++;
	}
	return { views, skipped: skipped + Math.max(0, raw.length - 200) };
}
