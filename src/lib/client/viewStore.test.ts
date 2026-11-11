import { describe, expect, it, vi } from 'vitest';
import { loadStored, saveStored, storageKey, type KV } from './viewStore.svelte';
import { defaultViews } from '$lib/views.config';

class MemKV implements KV {
	m = new Map<string, string>();
	getItem(k: string) {
		return this.m.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, v);
	}
}

describe('localStorage views', () => {
	it('uses a per-user key', () => {
		expect(storageKey(42)).toBe('board.views.v1.42');
	});

	it('round-trips views and skips corrupt entries', () => {
		const kv = new MemKV();
		const v = { ...defaultViews[0], id: 'u-1', name: 'Mine' };
		expect(saveStored(kv, 'k', { views: [v], order: ['u-1'] })).toBe(true);
		expect(loadStored(kv, 'k').state.views).toEqual([v]);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		kv.setItem('k', JSON.stringify({ views: [v, { id: 'bad' }, 'x'], order: ['u-1', 5] }));
		const r = loadStored(kv, 'k');
		expect(r.state.views).toHaveLength(1);
		expect(r.state.order).toEqual(['u-1']);
		expect(r.skipped).toBe(2);
		kv.setItem('k', '{not json');
		expect(loadStored(kv, 'k').state.views).toEqual([]);
		warn.mockRestore();
	});

	it('copes with blocked or full storage', () => {
		const blocked: KV = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(loadStored(blocked, 'k').ok).toBe(false);
		expect(saveStored(blocked, 'k', { views: [], order: [] })).toBe(false);
		expect(loadStored(null, 'k').ok).toBe(false);
	});
});
