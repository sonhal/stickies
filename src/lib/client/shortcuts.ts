/**
 * Every keyboard shortcut, in one list. The shortcut sheet (?) shows exactly this, so a key that is
 * added to the handlers (src/routes/(app)/+layout.svelte, BoardLayout, MatrixLayout) belongs here too.
 */

/** Where a shortcut works: everywhere, on list and board views, or on one layout only. */
export type ShortcutContext = 'global' | 'items' | 'list' | 'board' | 'matrix';
export type ShortcutGroup = 'Navigation' | 'Issue actions' | 'Board' | 'Matrix' | 'General';

export interface Shortcut {
	group: ShortcutGroup;
	label: string;
	/**
	 * Alternatives. `+` joins keys held together, a space separates keys pressed one after the other.
	 * `Mod` is ⌘ on a Mac and Ctrl elsewhere.
	 */
	keys: string[];
	context: ShortcutContext;
	/** Changes data: not offered on a read-only screen (kiosk) */
	write?: boolean;
	/** Short remark shown after the label */
	note?: string;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['Navigation', 'Issue actions', 'Board', 'Matrix', 'General'];

export const SHORTCUTS: Shortcut[] = [
	{ group: 'Navigation', label: 'Next issue', keys: ['J', '↓'], context: 'list' },
	{ group: 'Navigation', label: 'Previous issue', keys: ['K', '↑'], context: 'list' },
	{ group: 'Navigation', label: 'Open the selected issue', keys: ['Enter', 'O'], context: 'items' },
	{ group: 'Navigation', label: 'Go to view 1–9', keys: ['G 1…9'], context: 'global' },
	{ group: 'Navigation', label: 'Go to epics', keys: ['G E'], context: 'global' },
	{ group: 'Navigation', label: 'Go to the home view', keys: ['G H'], context: 'global' },
	{ group: 'Navigation', label: 'Focus search', keys: ['/'], context: 'global' },
	{ group: 'Navigation', label: 'Add a filter', keys: ['F'], context: 'global' },

	{ group: 'Issue actions', label: 'New issue', keys: ['C'], context: 'global', write: true },
	{ group: 'Issue actions', label: 'Change status', keys: ['S'], context: 'items', write: true },
	{ group: 'Issue actions', label: 'Change assignees', keys: ['A'], context: 'items', write: true },
	{ group: 'Issue actions', label: 'Assign to me', keys: ['I'], context: 'items', write: true },
	{ group: 'Issue actions', label: 'Change labels', keys: ['L'], context: 'list', write: true, note: 'lists only' },
	{ group: 'Issue actions', label: 'Change weight', keys: ['W'], context: 'items', write: true },
	{ group: 'Issue actions', label: 'Undo the last change', keys: ['Mod+Z'], context: 'global', write: true },

	{ group: 'Board', label: 'Up / down in the column', keys: ['↑', '↓', 'K', 'J'], context: 'board' },
	{ group: 'Board', label: 'Neighbouring column', keys: ['←', '→', 'H', 'L'], context: 'board' },
	{ group: 'Board', label: 'Move the card one column left', keys: ['Alt+←', 'Shift+H'], context: 'board', write: true },
	{ group: 'Board', label: 'Move the card one column right', keys: ['Alt+→', 'Shift+L'], context: 'board', write: true },

	{ group: 'Matrix', label: 'Next issue in the walk-through', keys: ['→', 'J'], context: 'matrix' },
	{ group: 'Matrix', label: 'Previous issue in the walk-through', keys: ['←', 'K'], context: 'matrix' },

	{ group: 'General', label: 'Command palette', keys: ['Mod+K'], context: 'global' },
	{ group: 'General', label: 'Keyboard shortcuts', keys: ['?'], context: 'global' },
	{ group: 'General', label: 'Hide or show the sidebar', keys: ['['], context: 'global' },
	{ group: 'General', label: 'Close, step by step', note: 'dialog, panel, selection', keys: ['Esc'], context: 'global' }
];

/** The shortcuts to show, by group, without empty groups. A read-only screen gets no write shortcuts. */
export function shortcutGroups(readOnly: boolean): { group: ShortcutGroup; items: Shortcut[] }[] {
	return SHORTCUT_GROUPS.map((group) => ({
		group,
		items: SHORTCUTS.filter((s) => s.group === group && !(readOnly && s.write))
	})).filter((g) => g.items.length > 0);
}

/**
 * One alternative as keys to draw: `Mod+K` → [['⌘', 'K']] on a Mac, `G E` → [['G'], ['E']].
 * Outer list: keys pressed one after the other. Inner list: keys held together.
 */
export function keyCaps(combo: string, mac: boolean): string[][] {
	const names: Record<string, string> = mac ? { Mod: '⌘', Alt: '⌥', Shift: '⇧' } : { Mod: 'Ctrl' };
	return combo.split(' ').map((chord) => chord.split('+').map((k) => names[k] ?? k));
}

/** The contexts that are live in each layout (for the "no key means two things" test). */
export const LAYOUT_CONTEXTS: Record<'list' | 'board' | 'matrix', ShortcutContext[]> = {
	list: ['global', 'items', 'list'],
	board: ['global', 'items', 'board'],
	matrix: ['global', 'matrix']
};
