import { describe, expect, it } from 'vitest';
import { registry, item, opt } from '$lib/testing/factory';
import { applyWrite, currentWriteValue, labelScope, toggleLabel } from './apply';

const reg = registry();
const f = (k: string) => reg.fields.find((x) => x.key === k)!;

describe('apply (optimistic UI)', () => {
	it('knows GitLab label scopes', () => {
		expect(labelScope('area::backend')).toBe('area');
		expect(labelScope('a::b::c')).toBe('a::b');
		expect(labelScope('bug')).toBeNull();
	});

	it('toggling a scoped label replaces the other label in its scope', () => {
		const labels = f('native:labels');
		expect(toggleLabel(labels, ['l-bug', 'l-be'], 'l-fe')).toEqual(['l-bug', 'l-fe']);
		expect(toggleLabel(labels, ['l-bug', 'l-be'], 'l-bug')).toEqual(['l-be']);
	});

	it('closes an item moved to a done status and can be rolled back', () => {
		const i = item({ 'native:status': opt('s-todo') });
		const done = applyWrite(i, f('native:status'), 'native:status', 's-done');
		expect(done.state).toBe('closed');
		expect(currentWriteValue(i, 'native:status')).toBe('s-todo');
		const back = applyWrite(done, f('native:status'), 'native:status', currentWriteValue(i, 'native:status'));
		expect(back.state).toBe('open');
		expect(back.values['native:status']).toEqual(opt('s-todo'));
	});

	it('clears values and moves parents', () => {
		const i = item({ 'native:weight': { kind: 'number', value: 3 } }, { parentId: 'p' });
		expect(applyWrite(i, f('native:weight'), 'native:weight', null).values['native:weight']).toBeUndefined();
		const moved = applyWrite(i, f('native:parent'), 'native:parent', null);
		expect(moved.parentId).toBeNull();
		expect(applyWrite(i, null, 'title', 'New').title).toBe('New');
	});
});
