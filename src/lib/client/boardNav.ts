/**
 * Keyboard navigation on a board: which card comes next for an arrow key. Pure, so it is unit-tested.
 * The board is a grid of cells, `cells[lane][column]`, each a list of item ids from top to bottom.
 * A board without lanes is one lane.
 */
export type NavDir = 'up' | 'down' | 'left' | 'right';
export type NavCells = string[][][];
export interface NavPos {
	lane: number;
	col: number;
	row: number;
}

/**
 * Where a card is. An item can sit in several columns (a board grouped by labels), so `hint` names
 * the cell the user was last in, and wins when the item is there.
 */
export function locate(cells: NavCells, id: string, hint?: { lane: number; col: number } | null): NavPos | null {
	if (hint) {
		const row = cells[hint.lane]?.[hint.col]?.indexOf(id) ?? -1;
		if (row !== -1) return { lane: hint.lane, col: hint.col, row };
	}
	for (let lane = 0; lane < cells.length; lane++)
		for (let col = 0; col < cells[lane].length; col++) {
			const row = cells[lane][col].indexOf(id);
			if (row !== -1) return { lane, col, row };
		}
	return null;
}

/** The non-empty column of a lane closest to `col` (the column itself first; on a tie, the left one). */
function nearestColumn(lane: string[][], col: number): number {
	for (let d = 0; d < lane.length; d++) {
		if (lane[col - d]?.length) return col - d;
		if (lane[col + d]?.length) return col + d;
	}
	return -1;
}

/**
 * The card an arrow key leads to, or null when there is nowhere to go (the selection then stays).
 *  - up/down: within the column. Past the end of a lane's cell it continues in the next lane that
 *    has cards (same column if it can), so every lane can be reached.
 *  - left/right: the nearest non-empty column of the same lane, at about the same row.
 *  - nothing selected (or the selected item isn't on the board): the first card.
 */
export function boardNext(
	cells: NavCells,
	current: string | null,
	dir: NavDir,
	hint?: { lane: number; col: number } | null
): { id: string; pos: NavPos } | null {
	const at = (pos: NavPos) => ({ id: cells[pos.lane][pos.col][pos.row], pos });
	const from = current ? locate(cells, current, hint) : null;
	if (!from) {
		for (let lane = 0; lane < cells.length; lane++) {
			const col = cells[lane].findIndex((c) => c.length > 0);
			if (col !== -1) return at({ lane, col, row: 0 });
		}
		return null;
	}
	const { lane, col, row } = from;
	if (dir === 'up' || dir === 'down') {
		const step = dir === 'down' ? 1 : -1;
		if (cells[lane][col][row + step] !== undefined) return at({ lane, col, row: row + step });
		for (let l = lane + step; l >= 0 && l < cells.length; l += step) {
			const c = nearestColumn(cells[l], col);
			if (c !== -1) return at({ lane: l, col: c, row: step === 1 ? 0 : cells[l][c].length - 1 });
		}
		return null;
	}
	const step = dir === 'right' ? 1 : -1;
	for (let c = col + step; c >= 0 && c < cells[lane].length; c += step) {
		const n = cells[lane][c].length;
		if (n) return at({ lane, col: c, row: Math.min(row, n - 1) });
	}
	return null;
}
