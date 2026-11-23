/**
 * Tool types. Each one turns an instance's config into something a renderer can draw.
 *
 * Value vs effort is a 2×2 grid, so it uses the quadrant renderer (MatrixLayout): `toView`
 * builds an internal view with the `matrix` layout. A future type that isn't a grid (e.g. a
 * RICE score ranking) adds its own `renderer` value and component in ToolPage.svelte.
 */
import type { FieldRef, MatrixConfig, ViewDefinition } from '$lib/query/types';
import type { ToolInstance, ToolTypeId, ValueEffortInstance } from './types';

export interface ToolType<I extends ToolInstance = ToolInstance> {
	id: I['type'];
	/** Shown next to the instance name: "Priority × effort · Value vs effort" */
	name: string;
	description: string;
	/** Sidebar icon (a character, aria-hidden) */
	icon: string;
	renderer: 'quadrants';
	toMatrix(instance: I): MatrixConfig;
}

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
		// The filter alone decides which statuses show (done and canceled too), so closed items aren't
		// dropped before it runs. CLOSED_DAYS_MAX still caps how far back closed items go.
		display: { properties: [], subIssues: 'flat', showEmptyGroups: true, completed: 'all' },
		matrix: toolType(instance).toMatrix(instance as never),
		rankDirection: instance.rankDirection
	};
}

/**
 * The fields the board prioritizes by: every instance's value axis (Priority), then its effort axis
 * (Effort), without repeats. The "New issue" dialog asks for these, so new work can be placed on the
 * matrix right away. References, not names in code (D2): they resolve against the live registry.
 */
export function prioritizationFields(instances: ToolInstance[]): FieldRef[] {
	const refs = [...instances.map((i) => i.value.field), ...instances.map((i) => i.effort.field)];
	const key = (r: FieldRef) => `${r.field ?? ''}|${(r.name ?? '').trim().toLowerCase()}`;
	return refs.filter((r, i) => refs.findIndex((o) => key(o) === key(r)) === i);
}

export function defineTools(instances: ToolInstance[]): ToolInstance[] {
	const ids = new Set<string>();
	for (const i of instances) {
		if (ids.has(i.id)) throw new Error(`Duplicate prioritization tool id "${i.id}"`);
		ids.add(i.id);
	}
	return instances;
}
