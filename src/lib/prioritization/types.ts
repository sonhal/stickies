/**
 * Prioritization tools: named, configured ways of looking at the issues through a prioritization
 * framework (Eisenhower matrix today; MoSCoW, RICE, WSJF … later).
 *
 * A *tool type* (tools.ts) defines a framework: its name, its config shape and how it is drawn.
 * A *tool instance* (src/lib/prioritization.config.ts) is one configured use of a type, e.g.
 * "Standup" = Eisenhower with urgency from weight and importance from Priority.
 *
 * Instances share the views' building blocks (filters, team/epic scope, field references) but are
 * not views: they have their own sidebar section and URL (/p/<id>), and are defined in config only.
 */
import type { AxisConfig, FilterGroup, QuadrantKey, RankDirection, ViewScope } from '$lib/query/types';

export type Quadrants = Partial<Record<QuadrantKey, { name: string; hint: string }>>;

interface InstanceBase {
	/** URL id: /p/<id>. Must be unique across instances and views (the kiosk list mixes both). */
	id: string;
	name: string;
	description?: string;
	/** Which items it looks at. Users can narrow it further with the filter bar. */
	filter: FilterGroup;
	scope?: ViewScope;
	/** Overrides the per-field rank direction for this instance */
	rankDirection?: RankDirection;
}

/** Eisenhower matrix: urgent × important → Do / Schedule / Delegate / Drop. */
export interface EisenhowerInstance extends InstanceBase {
	type: 'eisenhower';
	urgency: AxisConfig;
	importance: AxisConfig;
	/** Rename quadrants (defaults: Do, Schedule, Delegate, Drop) */
	quadrants?: Quadrants;
}

/** Value vs effort: high value × low effort first → Quick wins / Big bets / Fill-ins / Reconsider. */
export interface ValueEffortInstance extends InstanceBase {
	type: 'valueEffort';
	value: AxisConfig;
	effort: AxisConfig;
	quadrants?: Quadrants;
}

export type ToolInstance = EisenhowerInstance | ValueEffortInstance;
export type ToolTypeId = ToolInstance['type'];
