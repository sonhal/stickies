/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PRIORITIZATION CONFIG: the tools listed under "Prioritization" in the sidebar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each entry is an instance of a tool type (src/lib/prioritization/tools.ts):
 *
 *   type: 'valueEffort'  value × effort → Quick wins / Big bets / Fill-ins / Reconsider
 *
 * The board standardizes on Priority and Effort: the value and effort axes of these instances are
 * also the fields the "New issue" dialog asks for (see prioritizationFields in tools.ts).
 *
 * Axes take any ordered field, referenced like in views.config.ts: `{ field: 'native:weight' }` or
 * `{ name: 'Priority' }` for a custom field. Split an axis into low/high halves with:
 *   split: 'half'                   top half of the options (the default)
 *   split: { atOption: 'High' }     this option and above (falls back to 'half' if it's renamed)
 *   split: { threshold: 3 }         numbers ≥ 3
 *   split: { withinDays: 14 }       dates within 14 days, or overdue
 *
 * `filter` decides everything the board shows, done and canceled issues included: there is no
 * separate "completed" setting. Leave out the Status rule to show every status (closed items go back
 * CLOSED_DAYS_MAX days). Users change it in the filter bar or with `?status=` in the URL (see
 * src/lib/client/statusParam.ts), e.g. `/p/priority-effort?status=done` or `?status=!toDo,!done`.
 *
 * Ids share one namespace with view ids (KIOSK_VIEWS can list both), so keep them unique.
 * Every instance is checked by the unit tests.
 */
import { and, rule } from '$lib/query/define';
import { defineTools } from '$lib/prioritization/tools';

const notEpics = rule('native:type', 'noneOf', ['Epic']);
/** Open work only: done and canceled are hidden until the filter (or ?status=) asks for them. */
const notClosed = rule('native:status', 'noneOf', ['category:done', 'category:canceled']);

export const prioritizationTools = defineTools([
	{
		id: 'priority-effort',
		name: 'Priority × effort',
		type: 'valueEffort',
		description: 'Quick wins top-left: high priority, small effort.',
		filter: and(notEpics, notClosed),
		value: { field: { name: 'Priority' }, split: 'half', title: 'Priority' },
		effort: { field: { name: 'Effort' }, split: 'half' }
	}
]);
