import { describe, expect, it } from 'vitest';
import { compressToEncodedURIComponent } from 'lz-string';
import { decodeView, encodeView } from './share';
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
