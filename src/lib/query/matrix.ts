/**
 * The Eisenhower matrix as a layout: both axes come from any ordered field (§3.3).
 * Pure: no Svelte, no DOM.
 *
 * An item's position on an option axis is the option's normalized position (0…1) in GitLab's
 * order after the rank direction, so the matrix doesn't care how many options exist or what they're called.
 */
import {
	formatValue,
	normalizedPosition,
	optionRank,
	refLabel,
	resolveField,
	resolveOption,
	valueIds
} from '$lib/fields/registry';
import type { FieldDef, WorkItem } from '$lib/fields/types';
import { rankDirectionFor, type RankContext } from './rank';
import type { AxisConfig, MatrixConfig, QuadrantKey } from './types';

export const QUADRANT_ORDER: QuadrantKey[] = ['highHigh', 'lowHigh', 'highLow', 'lowLow'];

export const DEFAULT_QUADRANTS: Record<QuadrantKey, { name: string; hint: string }> = {
	highHigh: { name: 'Do', hint: 'Urgent and important' },
	lowHigh: { name: 'Schedule', hint: 'Important, not urgent' },
	highLow: { name: 'Delegate', hint: 'Urgent, not important' },
	lowLow: { name: 'Drop', hint: 'Neither' }
};

const DAY_MS = 86_400_000;
const DEFAULT_WITHIN_DAYS = 14;

export interface ResolvedAxis {
	config: AxisConfig;
	field: FieldDef | null;
	title: string;
	lowLabel: string;
	highLabel: string;
	/** The field is gone: every item is "missing" on this axis */
	problem: string | null;
	/** The axis works but not as configured, e.g. split option removed → fell back to half */
	warning: string | null;
	/** null = the item has no value on this axis */
	read: (item: WorkItem) => { high: boolean; score: number } | null;
	text: (item: WorkItem) => string;
}

function daysUntil(date: string, now: Date): number {
	const d = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	return Math.round((d - today) / DAY_MS);
}

/**
 * Index of the first "high" rank for an option axis with `count` options.
 * 'half': top half is high; with an odd count the middle option goes to `oddMiddle` (default high).
 */
export function halfCut(count: number, oddMiddle: 'high' | 'low' = 'high'): number {
	return oddMiddle === 'high' ? Math.floor(count / 2) : Math.ceil(count / 2);
}

export function resolveAxis(
	axis: AxisConfig,
	ctx: RankContext,
	items: WorkItem[],
	now: Date = new Date()
): ResolvedAxis {
	const field = resolveField(ctx.reg, axis.field);
	const title = axis.title ?? field?.name ?? refLabel(axis.field);
	const base = {
		config: axis,
		field,
		title,
		lowLabel: axis.lowLabel ?? `Low ${title.toLowerCase()}`,
		highLabel: axis.highLabel ?? `High ${title.toLowerCase()}`
	};
	if (!field) {
		return {
			...base,
			problem: `The field "${refLabel(axis.field)}" no longer exists in GitLab.`,
			warning: null,
			read: () => null,
			text: () => '—'
		};
	}
	const text = (item: WorkItem) => formatValue(ctx.reg, field, item.values[field.key]) || '—';
	const split = axis.split ?? 'half';
	let warning: string | null = null;

	if (field.kind === 'singleSelect' || field.kind === 'multiSelect' || field.kind === 'status') {
		const dir = rankDirectionFor(ctx, field, axis.rankDirection);
		const count = field.options?.length ?? 0;
		let cut = halfCut(count, axis.oddMiddle);
		if (typeof split === 'object' && 'atOption' in split) {
			const opt = resolveOption(field, split.atOption);
			const r = opt ? optionRank(field, opt.id, dir) : null;
			if (r) cut = r.rank;
			else warning = `"${title}" split option "${split.atOption}" no longer exists, so the axis is split in half.`;
		} else if (split !== 'half') {
			warning = `"${title}" is a select field, so the axis is split in half.`;
		}
		if (count === 0) warning = `"${title}" has no options.`;
		return {
			...base,
			problem: null,
			warning,
			text,
			read: (item) => {
				// multi-select: the highest selected option counts
				let best: { rank: number; pos: number } | null = null;
				for (const id of valueIds(item.values[field.key])) {
					const r = optionRank(field, id, dir);
					const pos = normalizedPosition(field, id, dir);
					if (r && pos !== null && (!best || r.rank > best.rank)) best = { rank: r.rank, pos };
				}
				return best ? { high: best.rank >= cut, score: best.pos } : null;
			}
		};
	}

	if (field.kind === 'number') {
		let threshold: number;
		if (typeof split === 'object' && 'threshold' in split) threshold = split.threshold;
		else {
			// 'half' on a number: the midpoint of the values on the board
			const vals = items
				.map((i) => i.values[field.key])
				.flatMap((v) => (v?.kind === 'number' ? [v.value] : []));
			threshold = vals.length ? (Math.min(...vals) + Math.max(...vals)) / 2 : 0;
			if (split !== 'half') warning = `"${title}" is a number field; set split: { threshold } to choose the cut.`;
		}
		return {
			...base,
			problem: null,
			warning,
			text,
			read: (item) => {
				const v = item.values[field.key];
				return v?.kind === 'number' ? { high: v.value >= threshold, score: v.value } : null;
			}
		};
	}

	if (field.kind === 'date') {
		let within = DEFAULT_WITHIN_DAYS;
		if (typeof split === 'object' && 'withinDays' in split) within = split.withinDays;
		else if (split !== 'half') warning = `"${title}" is a date field; set split: { withinDays } to choose the cut.`;
		return {
			...base,
			problem: null,
			warning,
			text,
			read: (item) => {
				const v = item.values[field.key];
				if (v?.kind !== 'date') return null;
				const left = daysUntil(v.value, now);
				// sooner = more urgent = higher score
				return { high: left <= within, score: -left };
			}
		};
	}

	return {
		...base,
		problem: `"${title}" can't be a matrix axis (it isn't an ordered field).`,
		warning: null,
		read: () => null,
		text
	};
}

export interface Placed {
	item: WorkItem;
	x: number;
	y: number;
	quadrant: QuadrantKey;
}

export interface Unplaced {
	item: WorkItem;
	missing: ('x' | 'y')[];
}

export function placeItems(
	items: WorkItem[],
	x: ResolvedAxis,
	y: ResolvedAxis
): { placed: Placed[]; unplaced: Unplaced[] } {
	const placed: Placed[] = [];
	const unplaced: Unplaced[] = [];
	for (const item of items) {
		const xv = x.read(item);
		const yv = y.read(item);
		if (!xv || !yv) {
			const missing: ('x' | 'y')[] = [];
			if (!xv) missing.push('x');
			if (!yv) missing.push('y');
			unplaced.push({ item, missing });
		} else {
			const quadrant = `${xv.high ? 'high' : 'low'}${yv.high ? 'High' : 'Low'}` as QuadrantKey;
			placed.push({ item, x: xv.score, y: yv.score, quadrant });
		}
	}
	return { placed, unplaced };
}

/** Most important first, then most urgent, then lowest issue number (stable between refreshes). */
export function groupByQuadrant(placed: Placed[]): Record<QuadrantKey, Placed[]> {
	const groups: Record<QuadrantKey, Placed[]> = { highHigh: [], lowHigh: [], highLow: [], lowLow: [] };
	for (const p of placed) groups[p.quadrant].push(p);
	for (const k of QUADRANT_ORDER) groups[k].sort((a, b) => b.y - a.y || b.x - a.x || a.item.iid - b.item.iid);
	return groups;
}

/**
 * Where each quadrant goes on screen, as rows top→bottom, each row left→right.
 * Default: important on top, urgent on the right (so "Do" is top-right). `invert` flips an axis.
 */
export function screenLayout(x: ResolvedAxis, y: ResolvedAxis) {
	const xs: ('low' | 'high')[] = x.config.invert ? ['high', 'low'] : ['low', 'high'];
	const ys: ('High' | 'Low')[] = y.config.invert ? ['Low', 'High'] : ['High', 'Low'];
	return {
		cells: ys.map((yy) => xs.map((xx) => `${xx}${yy}` as QuadrantKey)),
		xCaptions: xs.map((xx) => (xx === 'high' ? x.highLabel : x.lowLabel)),
		yCaptions: ys.map((yy) => (yy === 'High' ? y.highLabel : y.lowLabel))
	};
}

/** Quadrant walk-through order: the tool type's, or Eisenhower's. Always all four, each once. */
export function walkOrderOf(m: MatrixConfig): QuadrantKey[] {
	const custom = (m.walkOrder ?? []).filter((k, i, a) => QUADRANT_ORDER.includes(k) && a.indexOf(k) === i);
	return [...custom, ...QUADRANT_ORDER.filter((k) => !custom.includes(k))];
}

export function quadrantsOf(m: MatrixConfig): Record<QuadrantKey, { name: string; hint: string }> {
	return { ...DEFAULT_QUADRANTS, ...(m.quadrants ?? {}) };
}

// ---- Position inside a quadrant ------------------------------------------------------------------

/** One cell of the grid inside a quadrant: 1-based CSS grid row/column, and the items in it. */
export interface QuadrantCell {
	row: number;
	col: number;
	items: Placed[];
}

/**
 * Buckets for one axis inside one quadrant: each distinct score gets its own position, lowest first.
 * More than `max` distinct scores (e.g. weights 3, 4, 5, 8, 13) are merged into `max` equal ranges,
 * so a numeric axis can't spread a quadrant over a dozen thin columns.
 */
export function scoreBuckets(scores: number[], max = 4): (score: number) => number {
	const distinct = [...new Set(scores)].sort((a, b) => a - b);
	if (distinct.length <= max) return (s) => Math.max(0, distinct.indexOf(s));
	const lo = distinct[0];
	const span = distinct[distinct.length - 1] - lo || 1;
	return (s) => Math.min(max - 1, Math.floor(((s - lo) / span) * max));
}

/**
 * Lay a quadrant's items out on a grid by their axis scores: higher x further right, higher y
 * further up (both flipped when the axis is inverted, matching the quadrants themselves). Only
 * positions that have items get a row/column, so empty space doesn't eat the quadrant. Items in a
 * cell keep the quadrant's order (most important, then most urgent, then oldest).
 */
export function quadrantCells(
	placed: Placed[],
	opts: { invertX?: boolean; invertY?: boolean; maxBuckets?: number } = {}
): { cols: number; rows: number; cells: QuadrantCell[] } {
	if (placed.length === 0) return { cols: 0, rows: 0, cells: [] };
	const max = opts.maxBuckets ?? 4;
	const xb = scoreBuckets(placed.map((p) => p.x), max);
	const yb = scoreBuckets(placed.map((p) => p.y), max);
	// Only buckets in use become grid lines, in order
	const usedX = [...new Set(placed.map((p) => xb(p.x)))].sort((a, b) => a - b);
	const usedY = [...new Set(placed.map((p) => yb(p.y)))].sort((a, b) => a - b);
	if (opts.invertX) usedX.reverse();
	if (!opts.invertY) usedY.reverse(); // highest y on the top row
	const byCell = new Map<string, QuadrantCell>();
	for (const p of placed) {
		const col = usedX.indexOf(xb(p.x)) + 1;
		const row = usedY.indexOf(yb(p.y)) + 1;
		const k = `${row}:${col}`;
		if (!byCell.has(k)) byCell.set(k, { row, col, items: [] });
		byCell.get(k)!.items.push(p);
	}
	const cells = [...byCell.values()].sort((a, b) => a.row - b.row || a.col - b.col);
	return { cols: usedX.length, rows: usedY.length, cells };
}
