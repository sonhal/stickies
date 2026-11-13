import { describe, expect, it } from 'vitest';
import { keyCaps, LAYOUT_CONTEXTS, SHORTCUT_GROUPS, SHORTCUTS, shortcutGroups } from './shortcuts';

describe('shortcut list', () => {
	it('no key combination means two things in the same layout', () => {
		for (const [layout, contexts] of Object.entries(LAYOUT_CONTEXTS)) {
			const seen = new Map<string, string>();
			for (const s of SHORTCUTS.filter((x) => contexts.includes(x.context))) {
				for (const k of s.keys) {
					const key = k.toLowerCase();
					expect(seen.get(key), `"${k}" in ${layout}: ${seen.get(key)} / ${s.label}`).toBeUndefined();
					seen.set(key, s.label);
				}
			}
		}
	});

	it('every shortcut has keys, a label and a known group', () => {
		for (const s of SHORTCUTS) {
			expect(s.keys.length).toBeGreaterThan(0);
			expect(s.label).not.toBe('');
			expect(SHORTCUT_GROUPS).toContain(s.group);
		}
		expect(new Set(SHORTCUTS.map((s) => s.label)).size).toBe(SHORTCUTS.length);
	});

	it('a read-only screen is shown no write shortcuts', () => {
		const shown = shortcutGroups(true).flatMap((g) => g.items);
		expect(shown.some((s) => s.write)).toBe(false);
		expect(shown.map((s) => s.label)).not.toContain('New issue');
		expect(shown.map((s) => s.label)).toContain('Keyboard shortcuts');
		// "Issue actions" has only write shortcuts, so the whole group goes.
		expect(shortcutGroups(true).map((g) => g.group)).not.toContain('Issue actions');
		expect(shortcutGroups(false).map((g) => g.group)).toEqual(SHORTCUT_GROUPS);
	});

	it('draws ⌘ on a Mac and Ctrl elsewhere', () => {
		expect(keyCaps('Mod+K', true)).toEqual([['⌘', 'K']]);
		expect(keyCaps('Mod+K', false)).toEqual([['Ctrl', 'K']]);
		expect(keyCaps('G E', false)).toEqual([['G'], ['E']]);
		expect(keyCaps('Alt+←', false)).toEqual([['Alt', '←']]);
		expect(keyCaps('Mod+Backspace', true)).toEqual([['⌘', '⌫']]);
		expect(keyCaps('Mod+Backspace', false)).toEqual([['Ctrl', 'Backspace']]);
	});
});
