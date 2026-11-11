import { resolveField, type RankDirection } from '$lib/fields/registry';
import type { FieldDef, FieldRegistry } from '$lib/fields/types';
import type { FieldSetting } from './types';

/**
 * Where the rank direction of a field comes from, most specific first:
 * matrix axis → view → field setting in views.config.ts → the global default.
 */
export interface RankContext {
	reg: FieldRegistry;
	fieldSettings: FieldSetting[];
	defaultDirection: RankDirection;
	viewDirection?: RankDirection;
}

export function rankDirectionFor(ctx: RankContext, field: FieldDef, override?: RankDirection): RankDirection {
	if (override) return override;
	if (ctx.viewDirection) return ctx.viewDirection;
	for (const s of ctx.fieldSettings) {
		if (s.rankDirection && resolveField(ctx.reg, s.field)?.key === field.key) return s.rankDirection;
	}
	return ctx.defaultDirection;
}
