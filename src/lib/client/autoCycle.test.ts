import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CYCLE_SECONDS,
	MAX_CYCLE_SECONDS,
	MIN_CYCLE_SECONDS,
	cycleAfterNavigate,
	cycleParamValue,
	cycleSecondsOf,
	pauseAfterSelect,
	pauseAfterToggle,
	readCycleParam,
	withCycleParam
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

describe('carrying the cycle from page to page', () => {
	it('turns on, changes and turns off only where a URL says so', () => {
		expect(cycleAfterNavigate(null, p('v=abc'))).toBeNull();
		expect(cycleAfterNavigate(null, p('cycle=20'))).toBe('20');
		expect(cycleAfterNavigate('20', p('sidebar=hidden'))).toBe('20'); // a plain link keeps it
		expect(cycleAfterNavigate('20', p('cycle=30'))).toBe('30');
		expect(cycleAfterNavigate('20', p('cycle=off'))).toBeNull();
		expect(cycleAfterNavigate('20', p('cycle=0'))).toBeNull();
		expect(cycleAfterNavigate(null, p('cycle'))).toBe('');
	});
	it('reads the seconds of a carried value', () => {
		expect(cycleSecondsOf(null)).toBeNull();
		expect(cycleSecondsOf('')).toBe(DEFAULT_CYCLE_SECONDS);
		expect(cycleSecondsOf('20')).toBe(20);
		expect(cycleSecondsOf('1')).toBe(MIN_CYCLE_SECONDS);
	});
	it('puts the value in the address bar, or takes it out, keeping other params', () => {
		expect(withCycleParam(new URL('http://x/p/standup?sidebar=hidden'), '20')?.search).toBe('?sidebar=hidden&cycle=20');
		expect(withCycleParam(new URL('http://x/p/standup?cycle=20&q=1'), null)?.search).toBe('?q=1');
		expect(withCycleParam(new URL('http://x/p/standup?cycle=20'), '30')?.search).toBe('?cycle=30');
	});
	it('returns null when the URL already matches', () => {
		expect(withCycleParam(new URL('http://x/p/standup?cycle=20'), '20')).toBeNull();
		expect(withCycleParam(new URL('http://x/p/standup?cycle'), '')).toBeNull();
		expect(withCycleParam(new URL('http://x/p/standup'), null)).toBeNull();
	});
});
