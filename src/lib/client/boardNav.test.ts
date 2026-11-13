import { describe, expect, it } from 'vitest';
import { boardNext, locate, type NavCells } from './boardNav';

// One lane, four columns; the third is empty.
const flat: NavCells = [[['a1', 'a2', 'a3'], ['b1'], [], ['d1', 'd2']]];
// Two lanes, three columns.
const laned: NavCells = [
	[['a1', 'a2'], [], ['c1']],
	[[], ['y1', 'y2'], ['z1']]
];
const next = (cells: NavCells, id: string | null, dir: Parameters<typeof boardNext>[2]) => boardNext(cells, id, dir)?.id ?? null;

describe('boardNext', () => {
	it('selects the first card when nothing is selected, whatever the key', () => {
		for (const dir of ['up', 'down', 'left', 'right'] as const) expect(next(flat, null, dir)).toBe('a1');
		expect(next([[[], ['b1']]], null, 'down')).toBe('b1');
		expect(next(flat, 'not-on-the-board', 'down')).toBe('a1');
		expect(next([[[], []]], null, 'down')).toBeNull();
	});

	it('up and down stay in the column and stop at its ends', () => {
		expect(next(flat, 'a1', 'down')).toBe('a2');
		expect(next(flat, 'a3', 'up')).toBe('a2');
		expect(next(flat, 'a3', 'down')).toBeNull();
		expect(next(flat, 'a1', 'up')).toBeNull();
		expect(next(flat, 'b1', 'down')).toBeNull();
	});

	it('left and right skip empty columns and keep the row where they can', () => {
		expect(next(flat, 'a1', 'right')).toBe('b1');
		expect(next(flat, 'a3', 'right')).toBe('b1'); // column b is shorter: its last card
		expect(next(flat, 'b1', 'right')).toBe('d1'); // column c is empty
		expect(next(flat, 'd2', 'left')).toBe('b1');
		expect(next(flat, 'a2', 'left')).toBeNull();
		expect(next(flat, 'd1', 'right')).toBeNull();
	});

	it('left and right stay in the lane', () => {
		expect(next(laned, 'a2', 'right')).toBe('c1');
		expect(next(laned, 'z1', 'left')).toBe('y1');
		expect(next(laned, 'y1', 'left')).toBeNull(); // the lane has nothing further left
	});

	it('down past a lane continues in the next lane, in the nearest column that has cards', () => {
		expect(next(laned, 'c1', 'down')).toBe('z1');
		expect(next(laned, 'a2', 'down')).toBe('y1'); // column a is empty in lane 2
		expect(next(laned, 'a1', 'down')).toBe('a2');
		expect(next(laned, 'y1', 'up')).toBe('a2'); // enters the lane above at its last card
		expect(next(laned, 'z1', 'up')).toBe('c1');
		expect(next(laned, 'y2', 'down')).toBeNull();
	});

	it('an item shown in two columns is taken where the user last was', () => {
		const multi: NavCells = [[['x', 'a2'], ['b1', 'x', 'b3']]];
		expect(locate(multi, 'x')).toEqual({ lane: 0, col: 0, row: 0 });
		expect(locate(multi, 'x', { lane: 0, col: 1 })).toEqual({ lane: 0, col: 1, row: 1 });
		expect(boardNext(multi, 'x', 'down', { lane: 0, col: 1 })?.id).toBe('b3');
		expect(boardNext(multi, 'x', 'down')?.id).toBe('a2');
		// A stale hint (the card moved away) falls back to wherever the card is now.
		expect(locate(multi, 'b3', { lane: 0, col: 0 })).toEqual({ lane: 0, col: 1, row: 2 });
	});

	it('reports the new position, so the caller can remember the cell', () => {
		expect(boardNext(flat, 'b1', 'right')).toEqual({ id: 'd1', pos: { lane: 0, col: 3, row: 0 } });
	});
});
