/**
 * View definitions: what to show and how. Pure data, validated (schema.ts) every time one is
 * loaded from the config file, localStorage or a URL. Fields are referenced by FieldRef, never by
 * a hard-coded name in code.
 */
import type { FieldRef, RankDirection } from '$lib/fields/registry';

export type { FieldRef, RankDirection };

export const CMPS = [
	'is',
	'isNot',
	'anyOf',
	'noneOf',
	'empty',
	'notEmpty',
	'gt',
	'lt',
	'before',
	'after',
	'contains'
] as const;
export type Cmp = (typeof CMPS)[number];

/**
 * value:
 *  - option fields: option ids, or labels as a fallback ("High"); status also takes `category:done` etc.
 *  - people: user ids or usernames, or `me`
 *  - dates: YYYY-MM-DD, `today`, `today+7`, `today-30`
 *  - numbers: a number
 */
export type FilterValue = string | number | string[];

export interface FilterRule {
	field: FieldRef;
	cmp: Cmp;
	value?: FilterValue;
}

export interface FilterGroup {
	op: 'and' | 'or';
	rules: (FilterRule | FilterGroup)[];
}

export const isGroup = (r: FilterRule | FilterGroup): r is FilterGroup => 'op' in r;

export type Layout = 'list' | 'board' | 'matrix';

/** Completed / canceled items to show, like Linear. "all" = everything within CLOSED_DAYS_MAX. */
export type CompletedWindow = 'all' | 'day' | 'week' | 'month' | 'none';

export const COMPLETED_DAYS: Record<CompletedWindow, number> = {
	all: Infinity,
	day: 1,
	week: 7,
	month: 30,
	none: 0
};

export type SubIssues = 'nested' | 'flat' | 'hidden';

export interface OrderBy {
	field: FieldRef | 'manual';
	dir: 'asc' | 'desc';
}

export interface Display {
	/** Fields shown as chips on rows/cards */
	properties: FieldRef[];
	subIssues: SubIssues;
	showEmptyGroups: boolean;
	completed: CompletedWindow;
}

/**
 * How an axis splits into low/high halves:
 *  - 'half': the top half of the options is "high" (odd count: the middle option goes to `oddMiddle`)
 *  - { atOption }: this option and everything above it is "high"; falls back to 'half' with a warning
 *  - { threshold }: numbers ≥ threshold are "high"
 *  - { withinDays }: dates within N days (or overdue) are "high"
 */
export type Split = 'half' | { atOption: string } | { threshold: number } | { withinDays: number };

export interface AxisConfig {
	field: FieldRef;
	split?: Split;
	rankDirection?: RankDirection;
	oddMiddle?: 'high' | 'low';
	/** Defaults to the field name */
	title?: string;
	lowLabel?: string;
	highLabel?: string;
	/** Put the high half on the left (x) / bottom (y) */
	invert?: boolean;
}

export type QuadrantKey = 'highHigh' | 'lowHigh' | 'highLow' | 'lowLow';

export interface MatrixConfig {
	x: AxisConfig;
	y: AxisConfig;
	quadrants?: Partial<Record<QuadrantKey, { name: string; hint: string }>>;
}

export interface ViewScope {
	/** Project full paths (Team = project) */
	projects?: string[];
	/** Epic (work item) global ids */
	epics?: string[];
}

export interface ViewDefinition {
	version: 1;
	id: string;
	name: string;
	description?: string;
	scope?: ViewScope;
	filter: FilterGroup;
	layout: Layout;
	groupBy?: FieldRef | null;
	subGroupBy?: FieldRef | null;
	orderBy: OrderBy[];
	display: Display;
	matrix?: MatrixConfig;
	/** Overrides the per-field rank direction for this view */
	rankDirection?: RankDirection;
}

/** Per-field settings from views.config.ts, e.g. the rank direction of a select field. */
export interface FieldSetting {
	field: FieldRef;
	rankDirection?: RankDirection;
}
