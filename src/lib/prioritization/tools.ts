/**
 * Tool types. Each one turns an instance's config into something a renderer can draw.
 *
 * Both current types are 2×2 grids, so they share the quadrant renderer (MatrixLayout): `toView`
 * builds an internal view with the `matrix` layout. A future type that isn't a grid (e.g. a
 * RICE score ranking) adds its own `renderer` value and component in ToolPage.svelte.
 */
import type { MatrixConfig, ViewDefinition } from '$lib/query/types';
import type { EisenhowerInstance, ToolInstance, ToolTypeId, ValueEffortInstance } from './types';

export interface ToolType<I extends ToolInstance = ToolInstance> {
	id: I['type'];
	/** Shown next to the instance name: "Standup · Eisenhower" */
	name: string;
	description: string;
	/** Sidebar icon (a character, aria-hidden) */
	icon: string;
	renderer: 'quadrants';
	toMatrix(instance: I): MatrixConfig;
}

const eisenhower: ToolType<EisenhowerInstance> = {
	id: 'eisenhower',
	name: 'Eisenhower',
	description: 'Urgent × important: Do, Schedule, Delegate, Drop.',
	icon: '▦',
	renderer: 'quadrants',
	toMatrix: (i) => ({
		x: { title: 'Urgency', lowLabel: 'Not urgent', highLabel: 'Urgent', ...i.urgency },
		y: { title: 'Importance', lowLabel: 'Not important', highLabel: 'Important', ...i.importance },
		// Do / Schedule / Delegate / Drop are the matrix defaults
		quadrants: i.quadrants,
		label: 'Eisenhower matrix'
	})
};

const valueEffort: ToolType<ValueEffortInstance> = {
	id: 'valueEffort',
	name: 'Value vs effort',
	description: 'High value, low effort first: Quick wins, Big bets, Fill-ins, Reconsider.',
	icon: '◩',
	renderer: 'quadrants',
	toMatrix: (i) => ({
		// Low effort is the low half, drawn on the left by default, so quick wins sit top-left
		x: { title: 'Effort', lowLabel: 'Small', highLabel: 'Large', ...i.effort },
		y: { title: 'Value', lowLabel: 'Lower', highLabel: 'Higher', ...i.value },
		quadrants: {
			lowHigh: { name: 'Quick wins', hint: 'High value, small effort' },
			highHigh: { name: 'Big bets', hint: 'High value, large effort' },
			lowLow: { name: 'Fill-ins', hint: 'Lower value, small effort' },
			highLow: { name: 'Reconsider', hint: 'Lower value, large effort' },
			...i.quadrants
		},
		label: 'Value vs effort matrix',
		// Quick wins first, then big bets, fill-ins, and what to reconsider
		walkOrder: ['lowHigh', 'highHigh', 'lowLow', 'highLow']
	})
};

export const TOOL_TYPES: { [K in ToolTypeId]: ToolType<Extract<ToolInstance, { type: K }>> } = {
	eisenhower,
	valueEffort
};

export function toolType(instance: ToolInstance): ToolType {
	return TOOL_TYPES[instance.type] as ToolType;
}

/**
 * The internal view a quadrant-type instance is drawn with. Not a user view: the `matrix` layout
 * is only reachable through a tool instance, and this is never stored or put in a share link.
 */
export function toView(instance: ToolInstance): ViewDefinition {
	return {
		version: 1,
		id: `p:${instance.id}`,
		name: instance.name,
		description: instance.description,
		scope: instance.scope,
		filter: instance.filter,
		layout: 'matrix',
		orderBy: [],
		display: { properties: [], subIssues: 'flat', showEmptyGroups: true, completed: 'none' },
		matrix: toolType(instance).toMatrix(instance as never),
		rankDirection: instance.rankDirection
	};
}

export function defineTools(instances: ToolInstance[]): ToolInstance[] {
	const ids = new Set<string>();
	for (const i of instances) {
		if (ids.has(i.id)) throw new Error(`Duplicate prioritization tool id "${i.id}"`);
		ids.add(i.id);
	}
	return instances;
}
