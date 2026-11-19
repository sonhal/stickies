import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CYCLE_SECONDS,
	MAX_CYCLE_SECONDS,
	MIN_CYCLE_SECONDS,
	cycleParamValue,
	pauseAfterSelect,
	pauseAfterToggle,
	readCycleParam
} from './autoCycle';

const p = (qs: string) => new URLSearchParams(qs);

describe('cycle param', () => {
	it('is off without the param or when switched off', () => {
		expect(readCycleParam(p(''))).toBeNull();
		expect(readCycleParam(p('sidebar=hidden'))).toBeNull();
		for (const v of ['0', '-5', 'off', 'false', 'no', 'OFF']) expect(readCycleParam(p(`cycle=${v}`))).toBeNull();
	});
	it('uses the default for a bare flag, on/true, or junk', () => {
		for (const qs of ['cycle', 'cycle=', 'cycle=on', 'cycle=true', 'cycle=yes', 'cycle=abc'])
			expect(readCycleParam(p(qs))).toBe(DEFAULT_CYCLE_SECONDS);
	});
	it('takes seconds, rounded and clamped', () => {
		expect(readCycleParam(p('cycle=20'))).toBe(20);
		expect(readCycleParam(p('cycle=7.6'))).toBe(8);
		expect(readCycleParam(p('cycle=1'))).toBe(MIN_CYCLE_SECONDS);
		expect(readCycleParam(p('cycle=99999'))).toBe(MAX_CYCLE_SECONDS);
	});
	it('is passed on normalized', () => {
		expect(cycleParamValue(p('cycle'))).toBe('');
		expect(cycleParamValue(p('cycle=1'))).toBe(String(MIN_CYCLE_SECONDS));
		expect(cycleParamValue(p('cycle=on'))).toBe(String(DEFAULT_CYCLE_SECONDS));
		expect(cycleParamValue(p('cycle=off'))).toBeNull();
		expect(cycleParamValue(p(''))).toBeNull();
	});
});

describe('pausing', () => {
	it('closing the panel pauses until the next pick', () => {
		expect(pauseAfterSelect(null, null)).toBe('closed');
		expect(pauseAfterSelect('closed', 'a')).toBeNull();
		expect(pauseAfterSelect(null, 'a')).toBeNull();
	});
	it('a pause from the button holds through picks and closing', () => {
		expect(pauseAfterSelect('user', 'a')).toBe('user');
		expect(pauseAfterSelect('user', null)).toBe('user');
	});
	it('the button toggles, and play resumes from a closed pause', () => {
		expect(pauseAfterToggle(null)).toBe('user');
		expect(pauseAfterToggle('user')).toBeNull();
		expect(pauseAfterToggle('closed')).toBeNull();
	});
});
