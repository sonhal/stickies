import { describe, expect, it } from 'vitest';
import { RETURN_AFTER_MS, rotationTarget, type RotationState } from './kioskRotation';

const pages = ['/p/standup', '/v/team'];
const at = (over: Partial<RotationState>): RotationState => ({
	path: '/p/standup',
	pages,
	now: 100_000,
	lastInput: 0,
	lastMove: 0,
	rotateMs: 30_000,
	busy: false,
	...over
});

describe('kiosk rotation', () => {
	it('moves to the next page once the screen has been idle for a rotation period', () => {
		expect(rotationTarget(at({}))).toBe('/v/team');
		expect(rotationTarget(at({ path: '/v/team' }))).toBe('/p/standup');
		expect(rotationTarget(at({ path: '/' }))).toBe('/v/team'); // "/" is the first page
	});

	it('waits while someone is using the screen', () => {
		expect(rotationTarget(at({ lastInput: 100_000 - 29_000 }))).toBeNull();
		expect(rotationTarget(at({ lastMove: 100_000 - 10_000 }))).toBeNull();
	});

	it('never moves while an edit is saving, a dialog is open or someone is typing', () => {
		expect(rotationTarget(at({ busy: true }))).toBeNull();
		expect(rotationTarget(at({ path: '/epics/9', lastInput: 100_000 - RETURN_AFTER_MS, busy: true }))).toBeNull();
	});

	it('stays on an epic or issue page, and returns to the first page after a long idle', () => {
		expect(rotationTarget(at({ path: '/epics/9', now: RETURN_AFTER_MS - 1 }))).toBeNull();
		expect(rotationTarget(at({ path: '/issue/12', now: RETURN_AFTER_MS }))).toBe('/p/standup');
	});

	it('does nothing when rotation is off or there is nothing to rotate to', () => {
		expect(rotationTarget(at({ rotateMs: 0 }))).toBeNull();
		expect(rotationTarget(at({ pages: [] }))).toBeNull();
		expect(rotationTarget(at({ pages: ['/p/standup'] }))).toBeNull();
		// with one page, a kiosk left on an epic page still goes home
		expect(rotationTarget(at({ pages: ['/p/standup'], path: '/epics/9', now: RETURN_AFTER_MS }))).toBe('/p/standup');
	});
});
