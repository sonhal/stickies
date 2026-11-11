/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PRIORITIZATION CONFIG: the tools listed under "Prioritization" in the sidebar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Each entry is an instance of a tool type (src/lib/prioritization/tools.ts):
 *
 *   type: 'eisenhower'   urgency × importance → Do / Schedule / Delegate / Drop
 *   type: 'valueEffort'  value × effort       → Quick wins / Big bets / Fill-ins / Reconsider
 *
 * Axes take any ordered field, referenced like in views.config.ts: `{ field: 'native:weight' }` or
 * `{ name: 'Priority' }` for a custom field. Split an axis into low/high halves with:
 *   split: 'half'                   top half of the options (the default)
 *   split: { atOption: 'High' }     this option and above (falls back to 'half' if it's renamed)
 *   split: { threshold: 3 }         numbers ≥ 3
 *   split: { withinDays: 14 }       dates within 14 days, or overdue
 *
 * Ids share one namespace with view ids (KIOSK_VIEWS can list both), so keep them unique.
 * Every instance is checked by the unit tests.
 */
import { and, rule } from '$lib/query/define';
import { defineTools } from '$lib/prioritization/tools';

const notEpics = rule('native:type', 'noneOf', ['Epic']);

export const prioritizationTools = defineTools([
	{
		id: 'standup',
		name: 'Standup',
		type: 'eisenhower',
		description: 'Urgency from weight, importance from Priority.',
		filter: and(notEpics),
		urgency: { field: { field: 'native:weight' }, split: { threshold: 3 } }, // weight 3 and above is urgent
		importance: { field: { name: 'Priority' }, split: { atOption: 'High' } } // High and above is important
	},
	{
		id: 'priority-effort',
		name: 'Priority × effort',
		type: 'valueEffort',
		description: 'Quick wins top-left: high priority, small effort.',
		filter: and(notEpics),
		value: { field: { name: 'Priority' }, split: 'half', title: 'Priority' },
		effort: { field: { name: 'Effort' }, split: 'half' }
	}
]);
