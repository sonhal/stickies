import { describe, expect, it } from 'vitest';
import { registry, selectField, item, opt, people, many } from '$lib/testing/factory';
import { dropWrite } from './board';

const prio = selectField('custom:7', 'Priority', ['High', 'Low'], { appliesTo: ['Issue'] });
const reg = registry([prio]);
const f = (k: string) => reg.fields.find((x) => x.key === k)!;

describe('dropWrite', () => {
	it('sets single-select and status columns', () => {
		const i = item({ 'native:status': opt('s-todo') });
		expect(dropWrite(i, f('native:status'), 's-todo', 's-doing')).toEqual({ key: 'native:status', value: 's-doing' });
		expect(dropWrite(i, f('native:status'), 's-todo', 's-todo')).toBeNull();
		expect(dropWrite(i, f('native:status'), 's-todo', null)).toEqual({ error: "Status can't be empty" });
		expect(dropWrite(i, prio, null, 'custom:7/o1')).toEqual({ key: 'custom:7', value: 'custom:7/o1' });
		expect(dropWrite(i, prio, 'custom:7/o1', null)).toEqual({ key: 'custom:7', value: null });
	});

	it('swaps one value of multi-value fields', () => {
		const i = item({ 'native:assignees': people('u1', 'u2'), 'native:labels': many('l-bug', 'l-be') });
		expect(dropWrite(i, f('native:assignees'), 'u1', null)).toEqual({ key: 'native:assignees', value: ['u2'] });
		expect(dropWrite(i, f('native:labels'), 'l-bug', 'l-fe')).toEqual({ key: 'native:labels', value: ['l-fe'] }); // area:: is exclusive
	});

	it('refuses read-only fields and fields that do not apply', () => {
		const i = item({}, { type: 'Task' });
		expect(dropWrite(i, f('native:project'), 'g/api', 'g/web')).toHaveProperty('error');
		expect(dropWrite(i, prio, null, 'custom:7/o1')).toHaveProperty('error');
	});
});
