/** Small helpers for writing views in views.config.ts. */
import type { Cmp, FilterGroup, FilterRule, FilterValue, ViewDefinition } from './types';

export function rule(field: string, cmp: Cmp, value?: FilterValue): FilterRule {
	// 'native:…' / 'custom:…' are keys; anything else is a field name.
	const ref = /^(native|custom):/.test(field) ? { field } : { name: field };
	return value === undefined ? { field: ref, cmp } : { field: ref, cmp, value };
}

export const and = (...rules: (FilterRule | FilterGroup)[]): FilterGroup => ({ op: 'and', rules });
export const or = (...rules: (FilterRule | FilterGroup)[]): FilterGroup => ({ op: 'or', rules });

type ViewInput = Omit<ViewDefinition, 'version'> & { version?: 1 };

export function defineViews(views: ViewInput[]): ViewDefinition[] {
	return views.map((v) => ({ ...v, version: 1 }));
}
