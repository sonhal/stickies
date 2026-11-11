import { describe, expect, it } from 'vitest';
import { matchCommands, type Command } from './commands';

const c = (group: string, label: string, hint?: string): Command => ({ id: label, group, label, hint, run: () => {} });

describe('matchCommands', () => {
	const cmds = [c('Views', 'My issues'), c('Issues', 'Fix login bug', 'api#12'), c('Views', 'Standup'), c('Actions', 'Set status: In progress')];
	it('needs every word and ranks label prefixes first', () => {
		// group names match too, so "issues" also finds items in the Issues group
		expect(matchCommands(cmds, 'issues').map((x) => x.label)).toEqual(['My issues', 'Fix login bug']);
		expect(matchCommands(cmds, 'api#12')[0].label).toBe('Fix login bug');
		expect(matchCommands(cmds, 'status progress').map((x) => x.label)).toEqual(['Set status: In progress']);
		expect(matchCommands(cmds, '')).toHaveLength(4);
		expect(matchCommands(cmds, 'nothing here')).toEqual([]);
	});
});
