/**
 * Auto-cycle on a prioritization board (`?cycle` in the URL): the walk-through moves to the next
 * issue on its own every N seconds, so a wall screen shows each issue's full details in turn.
 *
 * - `?cycle`, `?cycle=on`, `?cycle=true` → every DEFAULT_CYCLE_SECONDS.
 * - `?cycle=<seconds>` → every that many seconds, clamped to MIN…MAX.
 * - `?cycle=0`, `?cycle=off`, `?cycle=false`, no param → off.
 *
 * Picking an issue by hand (click, ←/→, the panel's arrows) restarts the countdown, and the cycle
 * carries on from that issue. Closing the panel (× or Esc) pauses until the next pick; the pause
 * button (or Space) pauses until play is pressed.
 */
export const CYCLE_PARAM = 'cycle';
export const DEFAULT_CYCLE_SECONDS = 15;
export const MIN_CYCLE_SECONDS = 3;
export const MAX_CYCLE_SECONDS = 600;

/** Seconds per issue, or null when auto-cycle is off. */
export function readCycleParam(params: URLSearchParams): number | null {
	if (!params.has(CYCLE_PARAM)) return null;
	const raw = (params.get(CYCLE_PARAM) ?? '').trim().toLowerCase();
	if (raw === '' || raw === 'on' || raw === 'true' || raw === 'yes') return DEFAULT_CYCLE_SECONDS;
	if (raw === 'off' || raw === 'false' || raw === 'no') return null;
	const n = Number(raw);
	if (!Number.isFinite(n)) return DEFAULT_CYCLE_SECONDS; // a typo still means "cycle"
	if (n <= 0) return null;
	return Math.min(MAX_CYCLE_SECONDS, Math.max(MIN_CYCLE_SECONDS, Math.round(n)));
}

/** The `cycle` param as it should be passed on (kiosk redirect and rotation), or null. */
export function cycleParamValue(params: URLSearchParams): string | null {
	const secs = readCycleParam(params);
	if (secs === null) return null;
	return params.get(CYCLE_PARAM) === '' ? '' : String(secs);
}

/**
 * Why the cycle is paused:
 * - `user`: the pause button / Space. Stays paused until play, whatever is selected.
 * - `closed`: the panel was closed (nothing selected). Picking an issue resumes.
 */
export type CyclePause = 'user' | 'closed' | null;

/** The pause state after the selection changed (by hand or by the cycle itself). */
export function pauseAfterSelect(pause: CyclePause, selectedId: string | null): CyclePause {
	if (pause === 'user') return 'user';
	return selectedId === null ? 'closed' : null;
}

/** The pause state after the pause/play control. Play with nothing selected starts the walk. */
export function pauseAfterToggle(pause: CyclePause): CyclePause {
	return pause === null ? 'user' : null;
}
