/**
 * Phase 0 spike: check the GitLab GraphQL shapes the board relies on, with a READ-ONLY token.
 *
 *   GITLAB_URL=https://gitlab.example.com GITLAB_GROUP=acme/platform GITLAB_TOKEN=glpat-... \
 *     node scripts/introspect.ts [--out introspect-out] [--sample 20] [--no-scrub]
 *
 * (Node 22.18+ runs TypeScript directly. On older Node: npx tsx scripts/introspect.ts …)
 *
 * It prints a report and writes scrubbed fixtures in the same shape as
 * src/lib/server/gitlab/fixtures/, so they can replace the hand-written ones:
 *   capabilities.json, schema.json, workItems.open.json, workItems.closed.json, types.json, report.txt
 *
 * It only sends queries (no mutations). Give it a token with the `read_api` scope only.
 * Scrubbing replaces titles, descriptions, people, URLs, references and paths with placeholders,
 * but keeps ids, custom field names, option values, status names and label titles (you can
 * review the files before sharing them; pass --no-scrub to keep everything).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CAPABILITIES,
	groupWorkItemsQuery,
	parseCapabilities,
	schemaQuery,
	workItemFragment,
	type Capabilities
} from '../src/lib/server/gitlab/queries.ts';

const args = process.argv.slice(2);
const argValue = (name: string, dflt: string) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const OUT = argValue('--out', 'introspect-out');
const SAMPLE = Math.max(1, Math.min(100, Number(argValue('--sample', '20')) || 20));
const SCRUB = !args.includes('--no-scrub');

const GITLAB_URL = (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, '');
const GROUP = process.env.GITLAB_GROUP || '';
const TOKEN = process.env.GITLAB_TOKEN || '';
if (!GROUP || !TOKEN) {
	console.error('Set GITLAB_GROUP and GITLAB_TOKEN (a read_api token). GITLAB_URL defaults to https://gitlab.com.');
	process.exit(2);
}

const report: string[] = [];
const say = (line = '') => {
	report.push(line);
	console.log(line);
};

async function rest(path: string): Promise<{ status: number; body: unknown; headers: Headers }> {
	const res = await fetch(`${GITLAB_URL}/api/v4${path}`, {
		headers: { 'PRIVATE-TOKEN': TOKEN, Accept: 'application/json' },
		signal: AbortSignal.timeout(20_000)
	});
	let body: unknown = null;
	try {
		body = await res.json();
	} catch {
		/* not json */
	}
	return { status: res.status, body, headers: res.headers };
}

interface GqlResult {
	data?: Record<string, unknown> | null;
	errors?: { message: string; path?: unknown }[];
}

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<GqlResult> {
	const res = await fetch(`${GITLAB_URL}/api/graphql`, {
		method: 'POST',
		headers: { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) return { errors: [{ message: `HTTP ${res.status}` }] };
	return (await res.json()) as GqlResult;
}

function errorsOf(r: GqlResult): string {
	return (r.errors ?? []).map((e) => `  ! ${e.message}`).join('\n');
}

// ---- Scrubbing ---------------------------------------------------------------------------------

const aliases = new Map<string, string>();
function alias(kind: string, value: string): string {
	const k = `${kind}:${value}`;
	let a = aliases.get(k);
	if (!a) {
		a = `${kind}-${[...aliases.keys()].filter((x) => x.startsWith(kind + ':')).length + 1}`;
		aliases.set(k, a);
	}
	return a;
}
const SCRUB_KEYS: Record<string, string> = {
	title: 'title',
	description: 'text',
	// custom text field values (aliased in queries.ts) can hold customer names or other free text
	textValue: 'text',
	name: 'name',
	username: 'user',
	fullPath: 'path',
	webUrl: 'url',
	reference: 'ref',
	avatarUrl: 'url'
};
/** Keys whose `name`/`title` must survive: they describe fields, statuses, types and labels. */
const KEEP_PARENTS = new Set([
	'customField',
	'customFields',
	'workItemType',
	'workItemTypes',
	'status',
	'allowedStatuses',
	'labels',
	'iterationCadence',
	'rolledUpCountsByType'
]);

function scrub(value: unknown, parentKey = ''): unknown {
	if (!SCRUB) return value;
	if (Array.isArray(value)) return value.map((v) => scrub(v, parentKey));
	if (!value || typeof value !== 'object') return value;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		const keep = KEEP_PARENTS.has(parentKey) && (k === 'name' || k === 'title');
		if (typeof v === 'string' && SCRUB_KEYS[k] && !keep) {
			const kind = SCRUB_KEYS[k];
			out[k] = kind === 'url' ? `https://gitlab.example.com/${alias('page', v)}` : alias(kind, v);
		} else {
			// `nodes` is transparent: keep the meaningful parent key
			out[k] = scrub(v, k === 'nodes' ? parentKey : k);
		}
	}
	return out;
}

// ---- Main ---------------------------------------------------------------------------------------

const TYPES_TO_DESCRIBE = [
	'WorkItem',
	'WorkItemWidgetStatus',
	'WorkItemStatus',
	'WorkItemStatusCategoryEnum',
	'WorkItemWidgetCustomFields',
	'WorkItemCustomFieldValue',
	'WorkItemSelectFieldValue',
	'WorkItemNumberFieldValue',
	'WorkItemTextFieldValue',
	'WorkItemDateFieldValue',
	'CustomField',
	'CustomFieldType',
	'WorkItemWidgetHierarchy',
	'WorkItemTypeCountsByState',
	'WorkItemWidgetDefinitionStatus',
	'WorkItemUpdateInput',
	'WorkItemCreateInput',
	'WorkItemWidgetStatusInput',
	'WorkItemWidgetCustomFieldValueInputType',
	'WorkItemWidgetHierarchyUpdateInput',
	'WorkItemWidgetStartAndDueDateUpdateInput',
	'IssueType',
	'WorkItemSort'
];

const DESCRIBE = `query Describe($name: String!) {
  __type(name: $name) {
    name kind
    fields { name type { name kind ofType { name kind ofType { name kind } } } }
    inputFields { name type { name kind ofType { name kind ofType { name kind } } } }
    enumValues { name }
    possibleTypes { name }
  }
}`;

type TypeRef = { name: string | null; kind: string; ofType?: TypeRef | null };
const typeName = (t: TypeRef | null | undefined): string =>
	!t ? '?' : t.kind === 'NON_NULL' ? `${typeName(t.ofType)}!` : t.kind === 'LIST' ? `[${typeName(t.ofType)}]` : (t.name ?? '?');

async function main() {
	mkdirSync(OUT, { recursive: true });
	say(`GitLab: ${GITLAB_URL}   group: ${GROUP}`);

	// 1. Version
	const v = await rest('/version');
	say(`REST /version: ${v.status === 200 ? JSON.stringify(v.body) : `HTTP ${v.status}`}`);
	const meta = await gql('{ metadata { version revision enterprise } }');
	say(`GraphQL metadata: ${JSON.stringify(meta.data?.metadata ?? null)}${meta.errors ? '\n' + errorsOf(meta) : ''}`);

	const tokenInfo = await rest('/personal_access_tokens/self');
	if (tokenInfo.status === 200) {
		const scopes = (tokenInfo.body as { scopes?: string[] }).scopes ?? [];
		say(`Token scopes: ${scopes.join(', ')}${scopes.some((s) => s !== 'read_api') ? '   ⚠ use a read_api-only token for this script' : ''}`);
	}

	// 2. Capabilities
	say('\n== Capabilities (optional schema parts) ==');
	const capsRaw = await gql(CAPABILITIES);
	if (capsRaw.errors) say(errorsOf(capsRaw));
	const caps: Capabilities = parseCapabilities(capsRaw.data);
	for (const [k, val] of Object.entries(caps)) say(`  ${val ? '✓' : '✗'} ${k}`);
	writeFileSync(join(OUT, 'capabilities.json'), JSON.stringify(capsRaw.data ?? {}, null, 2));

	// 3. Type shapes
	say('\n== Type shapes ==');
	const types: Record<string, unknown> = {};
	for (const name of TYPES_TO_DESCRIBE) {
		const r = await gql(DESCRIBE, { name });
		const t = r.data?.__type as
			| {
					kind: string;
					fields?: { name: string; type: TypeRef }[] | null;
					inputFields?: { name: string; type: TypeRef }[] | null;
					enumValues?: { name: string }[] | null;
					possibleTypes?: { name: string }[] | null;
			  }
			| null
			| undefined;
		types[name] = t ?? null;
		if (!t) {
			say(`  ✗ ${name}: not in this schema`);
			continue;
		}
		const parts = [
			t.fields?.map((f) => `${f.name}: ${typeName(f.type)}`).join(', '),
			t.inputFields?.map((f) => `${f.name}: ${typeName(f.type)}`).join(', '),
			t.enumValues?.map((e) => e.name).join(' | '),
			t.possibleTypes?.map((p) => p.name).join(' | ')
		].filter(Boolean);
		say(`  ✓ ${name} (${t.kind}): ${parts.join(' ; ')}`);
	}
	writeFileSync(join(OUT, 'types.json'), JSON.stringify(types, null, 2));

	// 4. Schema query: custom fields, statuses
	say('\n== Schema query (the one the board sends) ==');
	const schema = await gql(schemaQuery(caps), { fullPath: GROUP });
	if (schema.errors) say(errorsOf(schema));
	const g = (schema.data?.group ?? null) as Record<string, any> | null;
	if (!g) say('  ✗ group not found or not visible to this token');
	const cfs = (g?.customFields?.nodes ?? []) as any[];
	say(`  Custom fields: ${cfs.length}`);
	for (const cf of cfs) {
		say(
			`    - ${cf.name} [${cf.fieldType}] id=${cf.id} active=${cf.active} types=${(cf.workItemTypes ?? []).map((t: any) => t.name).join('/') || 'all'}`
		);
		if (cf.selectOptions?.length) say(`        options (GitLab order): ${cf.selectOptions.map((o: any) => o.value).join(' → ')}`);
	}
	for (const t of (g?.workItemTypes?.nodes ?? []) as any[]) {
		const st = (t.widgetDefinitions ?? []).flatMap((d: any) => d.allowedStatuses ?? []);
		say(`  Type ${t.name} (${t.id}): ${st.length ? 'statuses: ' + st.map((s: any) => `${s.name}[${s.category ?? '?'}]`).join(', ') : 'no status widget'}`);
	}
	say(`  Projects: ${(g?.projects?.nodes ?? []).length}, labels: ${(g?.labels?.nodes ?? []).length}, milestones: ${(g?.milestones?.nodes ?? []).length}, iterations: ${(g?.iterations?.nodes ?? []).length}, members: ${(g?.groupMembers?.nodes ?? []).length}`);
	writeFileSync(join(OUT, 'schema.json'), JSON.stringify(scrub(schema.data ?? {}), null, 2));

	// 5. Items
	for (const state of ['opened', 'closed'] as const) {
		say(`\n== Work items, state=${state}, first ${SAMPLE} ==`);
		const r = await gql(groupWorkItemsQuery(caps), { fullPath: GROUP, state, first: SAMPLE });
		if (r.errors) say(errorsOf(r));
		const conn = (r.data?.group as any)?.workItems;
		const items = (conn?.nodes ?? []) as any[];
		const byType: Record<string, number> = {};
		const byNs: Record<string, number> = {};
		const widgetTypes = new Set<string>();
		let withStatus = 0;
		let withCustom = 0;
		let withParent = 0;
		let epicUnderEpic = 0;
		const ids = new Map(items.map((i) => [i.id, i]));
		for (const i of items) {
			byType[i.workItemType?.name ?? '?'] = (byType[i.workItemType?.name ?? '?'] ?? 0) + 1;
			const nsKind = /Project/.test(i.namespace?.id ?? '') ? 'project' : 'group';
			byNs[nsKind] = (byNs[nsKind] ?? 0) + 1;
			for (const w of i.widgets ?? []) {
				widgetTypes.add(w.type);
				if (w.status) withStatus++;
				if (w.customFieldValues?.length) withCustom++;
				if (w.parent) {
					withParent++;
					const p = ids.get(w.parent.id);
					if (p && i.workItemType?.name === 'Epic' && p.workItemType?.name === 'Epic') epicUnderEpic++;
				}
			}
		}
		say(`  Items: ${items.length}${conn?.pageInfo?.hasNextPage ? ' (more pages)' : ''}`);
		say(`  By type: ${JSON.stringify(byType)}   by namespace: ${JSON.stringify(byNs)}`);
		say(`  Widgets seen: ${[...widgetTypes].sort().join(', ')}`);
		say(`  With status: ${withStatus}, with custom field values: ${withCustom}, with parent: ${withParent}, epic→epic: ${epicUnderEpic}`);
		if (state === 'opened') {
			say(
				byNs.project
					? '  ✓ group workItems(includeDescendants: true) returns project-level items'
					: '  ✗ no project-level items returned: set GITLAB_ITEMS_MODE=projects (or the group has none)'
			);
			const restCount = await rest(`/groups/${encodeURIComponent(GROUP)}/issues?state=opened&per_page=1`);
			say(`  REST open issues in group (x-total): ${restCount.headers.get('x-total') ?? 'n/a'}`);
		}
		writeFileSync(join(OUT, `workItems.${state === 'opened' ? 'open' : 'closed'}.json`), JSON.stringify(scrub(r.data ?? {}), null, 2));
	}

	say(`\nFragment used:\n${workItemFragment(caps)}`);
	writeFileSync(join(OUT, 'report.txt'), report.join('\n') + '\n');
	console.log(`\nWrote ${OUT}/ (capabilities, types, schema, workItems.open, workItems.closed, report.txt)`);
	console.log(`Check them with:  GITLAB_FIXTURES=${OUT} npx vitest run src/lib/server/gitlab/fixtures-live.test.ts`);
}

main().catch((err) => {
	console.error('introspect failed:', err instanceof Error ? err.message : err);
	process.exit(1);
});
