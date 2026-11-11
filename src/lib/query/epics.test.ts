import { describe, expect, it } from 'vitest';
import { registry, item, opt } from '$lib/testing/factory';
import { epicProgress, epicSlug, pct } from './epics';

describe('epic progress', () => {
	const reg = registry();
	it('prefers GitLab rolled-up counts', () => {
		const e = item({}, { type: 'Epic', progress: { total: 10, closed: 4 } });
		expect(epicProgress(e, [], reg)).toEqual({ total: 10, closed: 4, source: 'gitlab' });
	});
	it('falls back to the direct children on the board', () => {
		const e = item({}, { type: 'Epic' });
		const kids = [
			item({ 'native:status': opt('s-done') }, { parentId: e.id, state: 'closed' }),
			item({ 'native:status': opt('s-nope') }, { parentId: e.id, state: 'closed' }),
			item({ 'native:status': opt('s-todo') }, { parentId: e.id })
		];
		const p = epicProgress(e, kids, reg);
		expect(p).toEqual({ total: 3, closed: 2, source: 'board' });
		expect(pct(p)).toBe(67);
		expect(pct({ total: 0, closed: 0, source: 'board' })).toBe(0);
		expect(epicSlug('gid://gitlab/WorkItem/900')).toBe('900');
	});
});
