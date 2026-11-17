import { describe, expect, it } from 'vitest';
import { item } from '$lib/testing/factory';
import { findItemByParam, issuePath, issueUrl, itemParam, keepShellParams, readScaleParam, readSidebarParam, withScaleParam, withSidebarParam } from './urlState';

const a = item({}, { id: 'gid://gitlab/WorkItem/123', ref: 'team/api#7' });
const b = item({}, { id: 'gid://gitlab/WorkItem/456', ref: 'team/web#7' });
const epic = item({}, { id: 'gid://gitlab/WorkItem/789', ref: 'team&3', type: 'Epic' });

describe('issue links', () => {
	it('uses the number at the end of the global id', () => {
		expect(itemParam('gid://gitlab/WorkItem/123')).toBe('123');
		expect(issuePath('gid://gitlab/WorkItem/123')).toBe('/issue/123');
		expect(issueUrl(a.id, new URL('http://x/v/list?v=abc&sidebar=hidden'))).toBe('http://x/issue/123?sidebar=hidden');
		expect(issueUrl(a.id, new URL('http://x/v/list?v=abc'))).toBe('http://x/issue/123');
	});
	it('finds an item by short id, global id or reference', () => {
		expect(findItemByParam([a, b], '456')).toBe(b);
		expect(findItemByParam([a, b], 'gid://gitlab/WorkItem/123')).toBe(a);
		expect(findItemByParam([a, b], 'Team/API#7')).toBe(a);
		expect(findItemByParam([a, b, epic], 'team&3')).toBe(epic);
	});
	it('finds nothing for unknown, empty or junk values', () => {
		expect(findItemByParam([a, b], '999')).toBeNull();
		expect(findItemByParam([a, b], '')).toBeNull();
		expect(findItemByParam([a, b], null)).toBeNull();
		expect(findItemByParam([a, b], '#7')).toBeNull();
		expect(findItemByParam([a, b], 'x'.repeat(1000))).toBeNull();
	});
});

describe('sidebar param', () => {
	it('only hides for sidebar=hidden', () => {
		expect(readSidebarParam(new URLSearchParams('sidebar=hidden'))).toBe(true);
		expect(readSidebarParam(new URLSearchParams('sidebar=shown'))).toBe(false);
		expect(readSidebarParam(new URLSearchParams('sidebar=maybe'))).toBe(false);
		expect(readSidebarParam(new URLSearchParams(''))).toBe(false);
	});
	it('adds and removes it, keeping other params', () => {
		expect(withSidebarParam(new URL('http://x/v/list?v=abc'), true)?.search).toBe('?v=abc&sidebar=hidden');
		expect(withSidebarParam(new URL('http://x/?sidebar=hidden&q=1'), false)?.search).toBe('?q=1');
	});
	it('returns null when the URL already matches', () => {
		expect(withSidebarParam(new URL('http://x/?v=abc'), false)).toBeNull();
		expect(withSidebarParam(new URL('http://x/?sidebar=hidden'), true)).toBeNull();
	});
	it('is carried into a page-built query string', () => {
		expect(keepShellParams('q=new', new URLSearchParams('q=old&sidebar=hidden'))).toBe('q=new&sidebar=hidden');
		expect(keepShellParams('', new URLSearchParams('q=old&issue=1'))).toBe('');
	});
});

describe('scale param', () => {
	const read = (qs: string) => readScaleParam(new URLSearchParams(qs));
	it('reads a positive number, clamped and rounded', () => {
		expect(read('scale=2.5')).toBe(2.5);
		expect(read('scale=2')).toBe(2);
		expect(read('scale=1.333333')).toBe(1.33);
		expect(read('scale=10')).toBe(4);
		expect(read('scale=0.1')).toBe(0.5);
	});
	it('ignores anything that is not a positive number', () => {
		for (const qs of ['', 'scale=', 'scale=big', 'scale=0', 'scale=-2', 'scale=Infinity', 'scale=1e999', 'scale=%20'])
			expect(read(qs)).toBeNull();
	});
	it('sets it, drops it at 1, and keeps other params', () => {
		expect(withScaleParam(new URL('http://x/v/list?v=abc'), 2.5)?.search).toBe('?v=abc&scale=2.5');
		expect(withScaleParam(new URL('http://x/?scale=2&q=1'), 1)?.search).toBe('?q=1');
		expect(withScaleParam(new URL('http://x/?scale=2'), 3)?.search).toBe('?scale=3');
	});
	it('returns null when the URL already matches', () => {
		expect(withScaleParam(new URL('http://x/?v=abc'), 1)).toBeNull();
		expect(withScaleParam(new URL('http://x/?scale=2.5'), 2.5)).toBeNull();
		expect(withScaleParam(new URL('http://x/?scale=2.50'), 2.5)).toBeNull();
	});
	it('is carried into a page-built query string with the sidebar param', () => {
		expect(keepShellParams('q=new', new URLSearchParams('sidebar=hidden&scale=2.5'))).toBe('q=new&sidebar=hidden&scale=2.5');
		expect(keepShellParams('', new URLSearchParams('scale=1'))).toBe('');
		expect(keepShellParams('', new URLSearchParams('scale=junk'))).toBe('');
		expect(keepShellParams('scale=3', new URLSearchParams('scale=2'))).toBe('scale=3');
	});
});
