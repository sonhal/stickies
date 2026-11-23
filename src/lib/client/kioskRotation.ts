/**
 * Kiosk rotation (KIOSK_ROTATE_SECONDS) that doesn't fight the people using the screen.
 *
 * - It moves on only after the screen has had no input (pointer, key, wheel, touch) for a full
 *   rotation period, and never while something is in progress (an edit saving, a dialog open,
 *   someone typing).
 * - On a page outside the rotation (an epic, an issue someone opened) it stays put, and goes back
 *   to the first rotation page once nobody has touched the screen for RETURN_AFTER_MS.
 */

/** Idle time after which a kiosk left on an epic or issue page goes back to the rotation */
export const RETURN_AFTER_MS = 5 * 60_000;

export interface RotationState {
	/** Current pathname */
	path: string;
	/** Rotation pages in order (KIOSK_VIEWS as paths). "/" counts as the first. */
	pages: readonly string[];
	now: number;
	/** Last user input on the screen */
	lastInput: number;
	/** Last time the rotation moved (or started) */
	lastMove: number;
	rotateMs: number;
	/** An edit is saving, a dialog is open, or someone is typing */
	busy: boolean;
}

/** Where to go now, or null to stay. */
export function rotationTarget(s: RotationState): string | null {
	if (!s.pages.length || s.rotateMs <= 0 || s.busy) return null;
	const idle = s.now - s.lastInput;
	const i = s.path === '/' ? 0 : s.pages.indexOf(s.path);
	if (i < 0) return idle >= RETURN_AFTER_MS ? s.pages[0] : null;
	if (s.pages.length < 2) return null;
	if (idle < s.rotateMs || s.now - s.lastMove < s.rotateMs) return null;
	return s.pages[(i + 1) % s.pages.length];
}
