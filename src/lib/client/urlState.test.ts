import { describe, expect, it } from 'vitest';
import { item } from '$lib/testing/factory';
import { findItemByParam, itemParam, keepShellParams, readSidebarParam, withShellState } from './urlState';

const a = item({}, { id: 'gid://gitlab/WorkItem/123', ref: 'team/api#7' });
const b = item({}, { id: 'gid://gitlab/WorkItem/456', ref: 'team/web#7' });
const epic = item({}, { id: 'gid://gitlab/WorkItem/789', ref: 'team&3', type: 'Epic' });

describe('issue links', () => {
	it('uses the number at the end of the global id', () => {
		expect(itemParam('gid://gitlab/WorkItem/123')).toBe('123');
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
});

describe('withShellState', () => {
	const url = new URL('http://x/v/list?v=abc');
	it('adds the panel and sidebar state, keeping other params', () => {
		const next = withShellState(url, { issue: a.id, sidebarHidden: true });
		expect(next?.search).toBe('?v=abc&issue=123&sidebar=hidden');
	});
	it('returns null when the URL already matches', () => {
		expect(withShellState(url, { issue: null, sidebarHidden: false })).toBeNull();
		expect(withShellState(new URL('http://x/?issue=123'), { issue: a.id, sidebarHidden: false })).toBeNull();
	});
	it('removes state that is no longer there', () => {
		const next = withShellState(new URL('http://x/?issue=123&sidebar=hidden&q=1'), { issue: null, sidebarHidden: false });
		expect(next?.search).toBe('?q=1');
	});
});

describe('keepShellParams', () => {
	it('carries the shell params into a page-built query string', () => {
		const cur = new URLSearchParams('q=old&issue=123&sidebar=hidden');
		expect(keepShellParams('q=new', cur)).toBe('q=new&issue=123&sidebar=hidden');
		expect(keepShellParams('', new URLSearchParams('q=old'))).toBe('');
	});
});
