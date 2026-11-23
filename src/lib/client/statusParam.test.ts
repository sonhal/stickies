import { describe, expect, it } from 'vitest';
import { and, or, rule } from '$lib/query/define';
import { runView } from '$lib/query/engine';
import { prioritizationTools } from '$lib/prioritization.config';
import { toView } from '$lib/prioritization/tools';
import { item, opt, registry } from '$lib/testing/factory';
import { readStatusParam, statusParamValue, withStatusSelection } from './statusParam';

const q = (s: string) => new URLSearchParams(s);
const notEpics = rule('native:type', 'noneOf', ['Epic']);
const notClosed = rule('native:status', 'noneOf', ['category:done', 'category:canceled']);

describe('readStatusParam', () => {
	it('is null without the param', () => {
		expect(readStatusParam(q(''))).toBeNull();
		expect(readStatusParam(q('cycle=10'))).toBeNull();
	});

	it('reads include and ! exclude lists, categories in any spelling', () => {
		expect(readStatusParam(q('status=todo,In-Progress'))).toEqual({
			include: ['category:toDo', 'category:inProgress'],
			exclude: []
		});
		expect(readStatusParam(q('status=!toDo,!DONE,!cancelled'))).toEqual({
			include: [],
			exclude: ['category:toDo', 'category:done', 'category:canceled']
		});
		expect(readStatusParam(q('status=done,!Blocked'))).toEqual({ include: ['category:done'], exclude: ['Blocked'] });
	});

	it('keeps status names, and a quoted name is never a category', () => {
		expect(readStatusParam(q('status=In review'))).toEqual({ include: ['In review'], exclude: [] });
		expect(readStatusParam(q('status="Done",!"To do"'))).toEqual({ include: ['Done'], exclude: ['To do'] });
	});

	it('all, empty and junk mean no status rule; duplicates collapse', () => {
		for (const s of ['status=all', 'status=', 'status', 'status=,,!', 'status=""']) {
			expect(readStatusParam(q(s)), s).toEqual({ include: [], exclude: [] });
		}
		expect(readStatusParam(q('status=done,done,Done'))).toEqual({ include: ['category:done'], exclude: [] });
	});

	it('passes the raw value on for the kiosk, capped', () => {
		expect(statusParamValue(q('status=!done'))).toBe('!done');
		expect(statusParamValue(q('x=1'))).toBeNull();
		expect(statusParamValue(q(`status=${'a'.repeat(900)}`))).toHaveLength(500);
	});
});

describe('withStatusSelection', () => {
	it('replaces the top-level Status rules in place and keeps everything else', () => {
		const f = and(notEpics, notClosed, rule('Priority', 'is', 'High'));
		const next = withStatusSelection(f, { include: ['category:done'], exclude: [] });
		expect(next).toEqual(and(notEpics, rule('native:status', 'anyOf', ['category:done']), rule('Priority', 'is', 'High')));
		expect(withStatusSelection(f, { include: [], exclude: [] })).toEqual(and(notEpics, rule('Priority', 'is', 'High')));
		expect(withStatusSelection(and(notEpics), { include: ['x'], exclude: ['y'] }).rules).toEqual([
			notEpics,
			rule('native:status', 'anyOf', ['x']),
			rule('native:status', 'noneOf', ['y'])
		]);
	});

	it('leaves nested and empty/set Status rules alone', () => {
		const alt = or(rule('native:status', 'is', 's-todo'), rule('Priority', 'is', 'High'));
		const f = and(alt, rule('native:status', 'notEmpty'), notClosed);
		expect(withStatusSelection(f, { include: ['category:done'], exclude: [] })).toEqual(
			and(alt, rule('native:status', 'notEmpty'), rule('native:status', 'anyOf', ['category:done']))
		);
	});

	it('adds the Status rules next to a "match any" filter, which keeps its meaning', () => {
		const any = or(rule('Priority', 'is', 'High'), rule('native:assignees', 'anyOf', ['me']));
		expect(withStatusSelection(any, { include: ['category:done'], exclude: [] })).toEqual(
			and(any, rule('native:status', 'anyOf', ['category:done']))
		);
		expect(withStatusSelection(any, { include: [], exclude: [] })).toBe(any);
	});
});

describe('the Priority × effort board', () => {
	const NOW = new Date('2026-11-10T12:00:00Z');
	const ctx = { rank: { reg: registry(), fieldSettings: [], defaultDirection: 'firstHighest' as const }, now: NOW, closedDaysMax: 30 };
	const closed = { state: 'closed' as const, closedAt: '2026-11-09T00:00:00Z' };
	const todo = item({ 'native:status': opt('s-todo') });
	const doing = item({ 'native:status': opt('s-doing') });
	const done = item({ 'native:status': opt('s-done') }, closed);
	const canceled = item({ 'native:status': opt('s-nope') }, closed);
	const closedNoStatus = item({}, closed);
	const oldDone = item({ 'native:status': opt('s-done') }, { state: 'closed', closedAt: '2026-08-01T00:00:00Z' });
	const all = [todo, doing, done, canceled, closedNoStatus, oldDone];
	const view = toView(prioritizationTools.find((t) => t.id === 'priority-effort')!);
	const shown = (param: string | null) => {
		const sel = param === null ? null : readStatusParam(q(`status=${param}`));
		const filter = sel ? withStatusSelection(view.filter, sel) : view.filter;
		return runView(all, { ...view, filter }, ctx).items.map((i) => i.id);
	};

	it('hides done and canceled by default, through its filter', () => {
		expect(shown(null)).toEqual([todo.id, doing.id]);
	});

	it('shows only done (closed without a status counts as done), within CLOSED_DAYS_MAX', () => {
		expect(shown('done')).toEqual([done.id, closedNoStatus.id]);
	});

	it('shows everything but to do and done', () => {
		expect(shown('!toDo,!done')).toEqual([doing.id, canceled.id]);
	});

	it('shows only to do, or every status', () => {
		expect(shown('toDo')).toEqual([todo.id]);
		expect(shown('all')).toEqual([todo.id, doing.id, done.id, canceled.id, closedNoStatus.id]);
	});
});
