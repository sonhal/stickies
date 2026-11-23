import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeFilter, decodeView, encodeFilter, encodeView } from './share';
import { and, or, rule } from '$lib/query/define';
import { MAX_DEPTH, MAX_RULES } from '$lib/query/schema';
import { prioritizationTools } from '$lib/prioritization.config';
import type { FilterGroup } from '$lib/query/types';
import { defaultViews } from '$lib/views.config';

describe('share links', () => {
	it('round-trips every default view', () => {
		for (const v of defaultViews) expect(decodeView(encodeView(v))).toEqual(v);
	});
	it('rejects junk, oversized and invalid payloads', () => {
		expect(decodeView(null)).toBeNull();
		expect(decodeView('%%%')).toBeNull();
		expect(decodeView('A'.repeat(7000))).toBeNull();
		expect(decodeView(compressToEncodedURIComponent('{"version":1}'))).toBeNull();
		expect(decodeView(compressToEncodedURIComponent('not json'))).toBeNull();
	});
});

describe('board filter links (?f=)', () => {
	it('round-trips every prioritization filter, and any and/or/exclude mix', () => {
		for (const t of prioritizationTools) expect(decodeFilter(encodeFilter(t.filter))).toEqual(t.filter);
		const f = and(
			rule('native:status', 'noneOf', ['category:toDo', 'category:done']),
			or(rule('Priority', 'anyOf', ['High', 'Critical']), rule('native:dueDate', 'before', 'today+7')),
			rule('native:assignees', 'anyOf', ['me']),
			rule('native:labels', 'empty')
		);
		expect(decodeFilter(encodeFilter(f))).toEqual(f);
	});

	it('rejects junk, oversized, invalid and over-limit filters', () => {
		expect(decodeFilter(null)).toBeNull();
		expect(decodeFilter('')).toBeNull();
		expect(decodeFilter('%%%')).toBeNull();
		expect(decodeFilter('A'.repeat(7000))).toBeNull();
		expect(decodeFilter(compressToEncodedURIComponent('{"op":"xor","rules":[]}'))).toBeNull();
		expect(decodeFilter(compressToEncodedURIComponent('{"op":"and","rules":[{"field":{},"cmp":"is"}]}'))).toBeNull();
		expect(decodeFilter(compressToEncodedURIComponent('{"op":"and","rules":[{"field":{"field":"evil"},"cmp":"is"}]}'))).toBeNull();
		const many = and(...Array.from({ length: MAX_RULES + 1 }, () => rule('Priority', 'is', 'High')));
		expect(decodeFilter(encodeFilter(many))).toBeNull();
		let deep: FilterGroup = and(rule('Priority', 'is', 'High'));
		for (let i = 0; i < MAX_DEPTH; i++) deep = and(deep);
		expect(decodeFilter(encodeFilter(deep))).toBeNull();
	});
});
