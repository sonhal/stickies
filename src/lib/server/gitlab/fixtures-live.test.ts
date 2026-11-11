/**
 * Runs the normalizer over fixtures written by `scripts/introspect.ts` from YOUR GitLab:
 *
 *   GITLAB_FIXTURES=introspect-out npx vitest run src/lib/server/gitlab/fixtures-live.test.ts
 *
 * Skipped when GITLAB_FIXTURES is not set. Prints what the board would see.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptySeen, mergeSeen, normalizeSchema, normalizeWorkItem, type RawSchema, type RawWorkItem } from './normalize';
import { parseCapabilities } from './queries';

const dir = process.env.GITLAB_FIXTURES ? resolve(process.env.GITLAB_FIXTURES) : null;
const read = (f: string) => (dir && existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);

describe.skipIf(!dir)('live fixtures from scripts/introspect.ts', () => {
	it('normalizes without losing items', () => {
		const caps = parseCapabilities(read('capabilities.json'));
		const reg = normalizeSchema((read('schema.json') ?? {}) as RawSchema, { iterations: caps.iterations });
		const seen = emptySeen();
		const projectPaths = new Set(reg.projects.map((p) => p.fullPath));
		const raw: RawWorkItem[] = [
			...(read('workItems.open.json')?.group?.workItems?.nodes ?? []),
			...(read('workItems.closed.json')?.group?.workItems?.nodes ?? [])
		];
		const items = raw.map((r) => normalizeWorkItem(r, { projectPaths, seen }));
		const merged = mergeSeen(reg, seen, items);
		expect(items.length).toBe(raw.length);

		const lines = [`capabilities: ${JSON.stringify(caps)}`, `warnings: ${merged.warnings.join('; ') || 'none'}`];
		for (const f of merged.fields) {
			const used = items.filter((i) => i.values[f.key]).length;
			lines.push(
				`${f.key.padEnd(18)} ${f.name.padEnd(16)} ${f.kind.padEnd(12)} options=${f.options?.length ?? '-'} on ${used}/${items.length} items${f.rawType ? ` (unknown type ${f.rawType}, read-only)` : ''}`
			);
		}
		const statuses = merged.fields.find((f) => f.key === 'native:status')?.options ?? [];
		lines.push(`statuses: ${statuses.map((s) => `${s.label}[${s.category ?? 'NO CATEGORY'}]`).join(', ')}`);
		lines.push(`with project: ${items.filter((i) => i.projectId).length}, with parent: ${items.filter((i) => i.parentId).length}, with progress: ${items.filter((i) => i.progress).length}`);
		console.log(lines.join('\n'));
	});
});
