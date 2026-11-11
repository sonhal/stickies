/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  VIEWS CONFIG: the default views everyone sees, plus board-wide settings.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Views reference fields by key (`{ field: 'native:status' }`) or by name (`{ name: 'Priority' }`).
 * Names are matched case-insensitively against the custom fields GitLab reports at runtime, so
 * this file works on any GitLab. If a named field or option doesn't exist, the view still loads:
 * the rule shows as "field removed" and is ignored.
 *
 * Option values are never needed: filters can use option labels as a fallback ("High").
 * Views are lists or kanban boards. 2×2 matrices (Eisenhower, value vs effort) are prioritization
 * tools, configured in src/lib/prioritization.config.ts.
 *
 * Native field keys: native:status, native:assignees, native:labels, native:weight, native:dueDate,
 * native:startDate, native:milestone, native:iteration, native:project, native:parent, native:epic, native:type,
 * native:createdAt, native:updatedAt. Custom fields: { name: '<field name>' } or { field: 'custom:<id>' }.
 *
 * Every view is validated (src/lib/query/schema.ts) by the unit tests, so a broken view fails CI.
 */
import type { RankDirection } from '$lib/fields/registry';
import type { FieldSetting, ViewDefinition } from '$lib/query/types';
import { and, defineViews, or, rule } from '$lib/query/define';

export const settings = {
	title: 'Board',

	/**
	 * How to read GitLab's option order. 'firstHighest': the first option is the highest
	 * (Critical, High, Medium, Low). Override per field below, or per view / prioritization axis.
	 */
	defaultRankDirection: 'firstHighest' as RankDirection,
	fieldSettings: [
		// { field: { name: 'Effort' }, rankDirection: 'firstLowest' },
	] as FieldSetting[],

	// Optional: lock an epic to a palette slot (1-8) so its color never moves.
	// Find the epic's id in the legend tooltip (the number in its work item id). Example: { 123456: 1 }
	epicColors: {} as Record<number, number>,

	// The open board refetches this often. 0 = only on page load / Refresh button.
	refreshSeconds: 60
};

/** Leave out Epics on item views: epics have their own pages. */
const notEpics = rule('native:type', 'noneOf', ['Epic']);

const STATUS = { field: 'native:status' };
const PRIORITY = { name: 'Priority' };
const listDisplay = {
	properties: [PRIORITY, { name: 'Effort' }, { field: 'native:labels' }, { field: 'native:dueDate' }],
	subIssues: 'nested' as const,
	showEmptyGroups: false,
	completed: 'week' as const
};
const byPriority = [{ field: PRIORITY, dir: 'desc' as const }];

export const defaultViews: ViewDefinition[] = defineViews([
	{
		id: 'my-issues',
		name: 'My issues',
		layout: 'list',
		filter: and(notEpics, rule('native:assignees', 'anyOf', ['me'])),
		groupBy: STATUS,
		orderBy: byPriority,
		display: listDisplay
	},
	{
		id: 'active',
		name: 'Active board',
		layout: 'board',
		filter: and(notEpics),
		groupBy: STATUS,
		orderBy: byPriority,
		display: { ...listDisplay, properties: [PRIORITY, { field: 'native:labels' }, { field: 'native:dueDate' }], subIssues: 'flat' }
	},
	{
		id: 'by-priority',
		name: 'By priority',
		layout: 'list',
		filter: and(notEpics),
		groupBy: PRIORITY,
		subGroupBy: null,
		orderBy: [{ field: STATUS, dir: 'desc' }],
		display: { ...listDisplay, properties: [STATUS, { name: 'Effort' }, { field: 'native:project' }], completed: 'none' }
	},
	{
		id: 'epics',
		name: 'Open issues by epic',
		description: 'Every open issue under its epic. Kiosk-friendly.',
		layout: 'list',
		filter: and(notEpics),
		// Epic, not parent: a task is grouped under its issue's epic, not under the issue.
		groupBy: { field: 'native:epic' },
		subGroupBy: STATUS,
		orderBy: byPriority,
		display: { ...listDisplay, completed: 'none' }
	},
	{
		id: 'team-boards',
		name: 'Team boards',
		layout: 'board',
		filter: and(notEpics),
		groupBy: STATUS,
		subGroupBy: { field: 'native:project' },
		orderBy: byPriority,
		display: { ...listDisplay, properties: [PRIORITY, { field: 'native:dueDate' }], subIssues: 'flat' }
	},
	{
		id: 'triage',
		name: 'Triage',
		description: 'In the triage status, or missing a priority.',
		layout: 'list',
		filter: and(notEpics, or(rule('native:status', 'anyOf', ['category:triage']), rule('Priority', 'empty'))),
		groupBy: { field: 'native:project' },
		orderBy: [{ field: { field: 'native:createdAt' }, dir: 'desc' }],
		display: { ...listDisplay, completed: 'none' }
	},
	{
		// Used by team (project) pages unless ?view= picks another one. Not tied to a team itself.
		id: 'team',
		name: 'Team issues',
		layout: 'list',
		filter: and(notEpics),
		groupBy: STATUS,
		orderBy: byPriority,
		display: listDisplay
	}
]);
