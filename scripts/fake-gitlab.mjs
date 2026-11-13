/**
 * A tiny fake GitLab for local demos, screenshots and Playwright smoke tests.
 * NOT a GitLab emulator: it answers exactly the operations the board sends (by operation name),
 * in the shapes from src/lib/server/gitlab/fixtures/, and keeps mutations in memory.
 *
 *   node scripts/fake-gitlab.mjs            # listens on http://localhost:4010
 *   FAKE_GITLAB_PORT=4011 node scripts/fake-gitlab.mjs
 *
 * Then run the board with GITLAB_URL=http://localhost:4010 (see README → "Try it without GitLab").
 * OAuth: /oauth/authorize redirects straight back with a code (no login screen).
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'src', 'lib', 'server', 'gitlab', 'fixtures');
const PORT = Number(process.env.FAKE_GITLAB_PORT ?? 4010);
const BASE = `http://localhost:${PORT}`;
const SCOPE = process.env.FAKE_GITLAB_SCOPE ?? 'api';

const caps = JSON.parse(readFileSync(join(fixtures, 'capabilities.json'), 'utf8'));
caps.dateValue = { name: 'WorkItemDateFieldValue' };
const schema = JSON.parse(readFileSync(join(fixtures, 'schema.json'), 'utf8'));
// The demo has no unknown-type field noise in the main list, but keeps one to show read-only text.
const group = schema.group;
group.groupMembers.nodes.push(
	{ user: { id: 'gid://gitlab/User/103', username: 'kim', name: 'Kim Lee' } },
	{ user: { id: 'gid://gitlab/User/104', username: 'priya', name: 'Priya Shah' } },
	{ user: { id: 'gid://gitlab/User/105', username: 'jo', name: 'Jo Park' } }
);
group.projects.nodes.push({ id: 'gid://gitlab/Project/24', name: 'Data', fullPath: 'acme/platform/data', webUrl: 'https://gitlab.example.com/acme/platform/data', archived: false });
group.labels.nodes = group.labels.nodes.filter((l) => l.title !== 'customer');
group.labels.nodes.push(
	{ id: 'gid://gitlab/GroupLabel/305', title: 'area::data', color: '#8f6fd6' },
	{ id: 'gid://gitlab/GroupLabel/306', title: 'tech debt', color: '#e2a03f' }
);

const users = Object.fromEntries(group.groupMembers.nodes.map((m) => [m.user.id, m.user]));
const statuses = new Map();
for (const t of group.workItemTypes.nodes)
	for (const d of t.widgetDefinitions ?? []) for (const s of d.allowedStatuses ?? []) statuses.set(s.id, s);
const labelsById = Object.fromEntries(group.labels.nodes.map((l) => [l.id, l]));
const milestonesById = Object.fromEntries(group.milestones.nodes.map((m) => [m.id, m]));
const iterationsById = Object.fromEntries(group.iterations.nodes.map((m) => [m.id, m]));
const fieldsById = Object.fromEntries(group.customFields.nodes.map((f) => [f.id, f]));
const typesByName = Object.fromEntries(group.workItemTypes.nodes.map((t) => [t.name, t]));
const typesById = Object.fromEntries(group.workItemTypes.nodes.map((t) => [t.id, t]));
const projects = Object.fromEntries(group.projects.nodes.map((p) => [p.fullPath, p]));

// ---- Deterministic demo data ------------------------------------------------------------------

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const NOW = Date.parse(process.env.FAKE_GITLAB_NOW ?? new Date().toISOString());
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const dateIn = (d) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10);

const S = {
	triage: 'gid://gitlab/WorkItems::Statuses::Custom::Status/30',
	todo: 'gid://gitlab/WorkItems::Statuses::SystemDefined::Status/1',
	doing: 'gid://gitlab/WorkItems::Statuses::SystemDefined::Status/2',
	done: 'gid://gitlab/WorkItems::Statuses::SystemDefined::Status/3',
	wont: 'gid://gitlab/WorkItems::Statuses::SystemDefined::Status/4',
	blocked: 'gid://gitlab/WorkItems::Statuses::Custom::Status/31'
};
const PRIO = fieldsById['gid://gitlab/Issuables::CustomField/7'];
const EFFORT = fieldsById['gid://gitlab/Issuables::CustomField/8'];
const COMP = fieldsById['gid://gitlab/Issuables::CustomField/9'];

/** The group every fake epic lives in */
const GROUP_PATH = 'acme/platform';

/** Raw items, in GitLab's shape, keyed by id */
const items = new Map();
let nextIid = { 'acme/platform': 10, 'acme/platform/api': 100, 'acme/platform/web': 200, 'acme/platform/data': 300 };
let nextId = 2000;

function makeItem({ type = 'Issue', path, title, desc = '', status, assignees = [], labels = [], weight = null, due = null, start = null, parent = null, prio, effort, comps = [], points = null, customer = null, milestone = null, iteration = null, closedDays = null, updatedDays = 1 }) {
	const id = `gid://gitlab/WorkItem/${nextId++}`;
	const iid = nextIid[path]++;
	const isEpic = type === 'Epic';
	const closed = closedDays !== null;
	const raw = {
		id,
		iid: String(iid),
		title,
		state: closed ? 'CLOSED' : 'OPEN',
		createdAt: daysAgo(40 + Math.floor(rnd() * 40)),
		updatedAt: daysAgo(closed ? closedDays : updatedDays),
		closedAt: closed ? daysAgo(closedDays) : null,
		webUrl: isEpic ? `${BASE}/groups/${path}/-/epics/${iid}` : `${BASE}/${path}/-/work_items/${iid}`,
		reference: isEpic ? `${path}&${iid}` : `${path}#${iid}`,
		workItemType: { id: typesByName[type].id, name: type },
		namespace: isEpic
			? { id: 'gid://gitlab/Group/9', fullPath: path, name: 'Platform' }
			: { id: `gid://gitlab/Namespaces::ProjectNamespace/${projects[path].id.split('/').pop()}`, fullPath: path, name: projects[path].name },
		_: { status, assignees, labels, weight, due, start, parent, prio, effort, comps, points, customer, milestone, iteration, desc }
	};
	items.set(id, raw);
	return id;
}

function opt(field, label) {
	return label ? field.selectOptions.find((o) => o.value === label)?.id ?? null : null;
}

const E1 = makeItem({ type: 'Epic', path: 'acme/platform', title: 'Payments v2', desc: 'Move payments to the new provider before the Q4 freeze.', start: dateIn(-60), due: dateIn(40) });
const E2 = makeItem({ type: 'Epic', path: 'acme/platform', title: 'Onboarding revamp', desc: 'Cut time-to-first-value in half.', start: dateIn(-20), due: dateIn(70) });
const E3 = makeItem({ type: 'Epic', path: 'acme/platform', title: 'Observability', desc: 'Dashboards and alerts for every service.' });
const E4 = makeItem({ type: 'Epic', path: 'acme/platform', title: 'Data platform', desc: 'Faster imports, exports and reporting.' });

const people = Object.keys(users);
const issues = [
	['acme/platform/api', 'Checkout fails for EU customers with a VAT id', E1, 'Critical', 'Medium', S.doing, 5],
	['acme/platform/api', 'Retry webhook deliveries with backoff', E1, 'High', 'Large', S.todo, 3],
	['acme/platform/web', 'New card form with inline validation', E1, 'High', 'Medium', S.doing, 3],
	['acme/platform/api', 'Refunds are not idempotent', E1, 'Critical', 'Small', S.blocked, 2],
	['acme/platform/api', 'Remove the legacy payment adapter', E1, 'Low', 'Large', S.todo, 5],
	['acme/platform/web', 'Welcome checklist on the dashboard', E2, 'Medium', 'Medium', S.todo, 2],
	['acme/platform/web', 'Invite teammates from the empty state', E2, 'High', 'Small', S.doing, 1],
	['acme/platform/api', 'Sign in with a magic link', E2, 'Medium', 'Large', S.triage, null],
	['acme/platform/web', 'Sample project for new workspaces', E2, 'Low', 'Small', S.todo, 1],
	['acme/platform/api', 'Trace ids in every log line', E3, 'Medium', 'Small', S.doing, 2],
	['acme/platform/api', 'Alert on queue depth', E3, 'High', 'Small', S.todo, 1],
	['acme/platform/web', 'Error budget dashboard', E3, 'Low', 'Medium', S.todo, 3],
	['acme/platform/data', 'Export reports as CSV', E4, 'High', 'Large', S.todo, 8],
	['acme/platform/data', 'Nightly backfill job', E4, 'Medium', 'Medium', S.doing, 3],
	['acme/platform/data', 'Import fails on files over 2 GB', E4, 'Critical', 'Small', S.todo, 1],
	['acme/platform/api', 'Rate limit the public search endpoint', null, 'High', 'Small', S.todo, 2],
	['acme/platform/web', 'Dark mode for the settings page', null, 'Low', 'Small', S.todo, 1],
	['acme/platform/web', 'Upgrade the charting library', null, 'Medium', null, S.triage, 2],
	['acme/platform/api', 'Slow query on the audit log', null, null, null, S.triage, null],
	['acme/platform/data', 'Saved search alerts', null, 'Medium', 'Medium', S.todo, null]
];
issues.forEach(([path, title, parent, prio, effort, status, weight], i) => {
	makeItem({
		path,
		title,
		parent,
		prio,
		effort,
		status,
		weight,
		desc: `## Context\n${title}. Reported by the **support** team.\n\n- [x] reproduce\n- [ ] fix\n- [ ] add a test`,
		assignees: i % 5 === 4 ? [] : [people[i % people.length]],
		labels: [
			...(i % 3 === 0 ? ['gid://gitlab/GroupLabel/301'] : []),
			path.endsWith('api') ? 'gid://gitlab/GroupLabel/302' : path.endsWith('web') ? 'gid://gitlab/GroupLabel/303' : 'gid://gitlab/GroupLabel/305'
		],
		due: i % 4 === 0 ? dateIn((i % 7) * 3 - 2) : null,
		comps: i % 2 ? ['API'] : ['Web', 'Billing'].slice(0, (i % 3) + 1),
		points: i % 3 ? (i % 8) + 1 : null,
		customer: i % 6 === 0 ? 'Big Co' : null,
		milestone: i % 2 ? 'gid://gitlab/Milestone/401' : null,
		iteration: i % 3 === 0 ? 'gid://gitlab/Iteration/501' : null,
		updatedDays: (i % 9) + 0.2
	});
});
// FAKE_GITLAB_EXTRA=N: N more generic open issues, to see how the views and matrices cope with volume.
// Deterministic (uses rnd), spread over every priority, effort, weight and status.
const EXTRA = Math.max(0, Math.min(500, Number(process.env.FAKE_GITLAB_EXTRA ?? 0) || 0));
{
	const verbs = ['Refactor', 'Document', 'Speed up', 'Add tests for', 'Clean up', 'Monitor', 'Simplify', 'Migrate', 'Audit', 'Cache'];
	const things = ['the billing service', 'user settings', 'the search index', 'report exports', 'the admin panel', 'webhooks', 'session handling', 'the import pipeline', 'email templates', 'feature flags', 'the public API docs', 'background jobs'];
	const prios = ['Critical', 'High', 'Medium', 'Low'];
	const efforts = ['Small', 'Medium', 'Large'];
	const statuses = [S.todo, S.todo, S.doing, S.doing, S.blocked, S.triage];
	const paths = ['acme/platform/api', 'acme/platform/web', 'acme/platform/data'];
	const epics = [E1, E2, E3, E4, null];
	for (let n = 0; n < EXTRA; n++) {
		makeItem({
			path: paths[n % paths.length],
			title: `${verbs[n % verbs.length]} ${things[(n * 7) % things.length]}`,
			parent: epics[(n * 3) % epics.length],
			prio: prios[Math.floor(rnd() * prios.length)],
			effort: efforts[Math.floor(rnd() * efforts.length)],
			status: statuses[Math.floor(rnd() * statuses.length)],
			weight: [1, 2, 3, 5, 8][Math.floor(rnd() * 5)],
			assignees: n % 4 ? [people[n % people.length]] : [],
			updatedDays: (n % 9) + 0.5
		});
	}
}

// A few tasks under issues
const firstIssue = [...items.values()].find((r) => r.title.startsWith('Checkout fails')).id;
makeItem({ type: 'Task', path: 'acme/platform/api', title: 'Write a failing test for the VAT case', parent: firstIssue, status: S.done, assignees: [people[1]], closedDays: 1 });
makeItem({ type: 'Task', path: 'acme/platform/api', title: 'Patch the tax calculator', parent: firstIssue, status: S.doing, assignees: [people[1]] });
// Recently completed / canceled
makeItem({ path: 'acme/platform/api', title: 'Rotate the payment provider keys', parent: E1, prio: 'High', effort: 'Small', status: S.done, weight: 1, closedDays: 0.5, assignees: [people[0]] });
makeItem({ path: 'acme/platform/web', title: 'Fix the pricing page layout on Safari', prio: 'Medium', effort: 'Small', status: S.done, weight: 1, closedDays: 3, assignees: [people[2]] });
makeItem({ path: 'acme/platform/web', title: 'Old onboarding tour', parent: E2, prio: 'Low', status: S.wont, closedDays: 5 });
makeItem({ path: 'acme/platform/data', title: 'Columnar storage spike', parent: E4, prio: 'Low', effort: 'Medium', status: S.done, closedDays: 20 });

// ---- Rendering raw items in GitLab's shape ------------------------------------------------------

function render(raw) {
	const d = raw._;
	const isEpic = raw.workItemType.name === 'Epic';
	const widgets = [
		{ type: 'DESCRIPTION', description: d.desc },
		{ type: 'ASSIGNEES', assignees: { nodes: d.assignees.map((id) => users[id]).filter(Boolean) } },
		{ type: 'LABELS', labels: { nodes: d.labels.map((id) => labelsById[id]).filter(Boolean) } },
		{ type: 'START_AND_DUE_DATE', startDate: d.start, dueDate: d.due }
	];
	const children = [...items.values()].filter((r) => r._.parent === raw.id);
	const counts = {};
	for (const c of children) {
		const t = c.workItemType.name;
		counts[t] ??= { all: 0, opened: 0, closed: 0 };
		counts[t].all++;
		counts[t][c.state === 'CLOSED' ? 'closed' : 'opened']++;
	}
	// Pretend older closed children exist too, so progress reflects GitLab's roll-up, not just the board.
	if (isEpic && counts.Issue) {
		counts.Issue.all += 2;
		counts.Issue.closed += 2;
	}
	widgets.push({
		type: 'HIERARCHY',
		parent: d.parent && items.get(d.parent)
			? { id: d.parent, title: items.get(d.parent).title, state: items.get(d.parent).state, workItemType: { name: items.get(d.parent).workItemType.name } }
			: d.parent ? { id: d.parent } : null,
		rolledUpCountsByType: Object.entries(counts).map(([name, c]) => ({ workItemType: { name }, countsByState: c }))
	});
	if (!isEpic) {
		widgets.push(
			{ type: 'MILESTONE', milestone: d.milestone ? milestonesById[d.milestone] : null },
			{ type: 'ITERATION', iteration: d.iteration ? iterationsById[d.iteration] : null },
			{ type: 'WEIGHT', weight: d.weight },
			{ type: 'STATUS', status: d.status ? statuses.get(d.status) ?? null : null }
		);
		const cfv = [];
		const typeName = raw.workItemType.name;
		for (const f of group.customFields.nodes) {
			const applies = !f.workItemTypes.length || f.workItemTypes.some((t) => t.name === typeName);
			if (!applies) continue;
			const ref = { id: f.id, name: f.name, fieldType: f.fieldType };
			if (f === PRIO) cfv.push({ customField: ref, selectedOptions: d.prio ? [{ id: opt(PRIO, d.prio) ?? d.prio, value: optLabel(PRIO, d.prio) }] : [] });
			else if (f === EFFORT) cfv.push({ customField: ref, selectedOptions: d.effort ? [{ id: opt(EFFORT, d.effort) ?? d.effort, value: optLabel(EFFORT, d.effort) }] : [] });
			else if (f === COMP) cfv.push({ customField: ref, selectedOptions: (d.comps ?? []).map((c) => ({ id: opt(COMP, c) ?? c, value: optLabel(COMP, c) })) });
			else if (f.fieldType === 'NUMBER') cfv.push({ customField: ref, numberValue: d.points });
			else if (f.fieldType === 'TEXT') cfv.push({ customField: ref, textValue: d.customer });
			else cfv.push({ customField: ref });
		}
		widgets.push({ type: 'CUSTOM_FIELDS', customFieldValues: cfv });
	}
	const { _, ...rest } = raw;
	return { ...rest, widgets };
}

/** d.prio etc. hold either a label (seed data) or an option id (after a mutation) */
function optLabel(field, v) {
	return field.selectOptions.find((o) => o.id === v || o.value === v)?.value ?? v;
}

// ---- Mutations -------------------------------------------------------------------------------

function applyUpdate(input) {
	const raw = items.get(input.id);
	if (!raw) return { errors: ["The resource that you are attempting to access does not exist or you don't have permission to perform this action"], workItem: null };
	const d = raw._;
	// Lets the smoke test check rollback: GitLab refuses this title like a permission error.
	if (typeof input.title === 'string' && input.title.includes('[reject]'))
		return { errors: ["The resource that you are attempting to access does not exist or you don't have permission to perform this action"], workItem: null };
	if (input.title !== undefined) raw.title = input.title;
	if (input.statusWidget) {
		d.status = input.statusWidget.status;
		const cat = statuses.get(d.status)?.category;
		raw.state = cat === 'DONE' || cat === 'CANCELED' ? 'CLOSED' : 'OPEN';
		raw.closedAt = raw.state === 'CLOSED' ? new Date().toISOString() : null;
	}
	if (input.assigneesWidget) d.assignees = input.assigneesWidget.assigneeIds;
	if (input.labelsWidget) {
		const add = input.labelsWidget.addLabelIds ?? [];
		const remove = new Set(input.labelsWidget.removeLabelIds ?? []);
		d.labels = [...new Set([...d.labels.filter((l) => !remove.has(l)), ...add])];
	}
	if (input.hierarchyWidget && 'parentId' in input.hierarchyWidget) d.parent = input.hierarchyWidget.parentId;
	if (input.milestoneWidget) d.milestone = input.milestoneWidget.milestoneId;
	if (input.iterationWidget) d.iteration = input.iterationWidget.iterationId;
	if (input.weightWidget) d.weight = input.weightWidget.weight;
	if (input.startAndDueDateWidget) {
		if ('startDate' in input.startAndDueDateWidget) d.start = input.startAndDueDateWidget.startDate;
		if ('dueDate' in input.startAndDueDateWidget) d.due = input.startAndDueDateWidget.dueDate;
	}
	for (const cf of input.customFieldsWidget ?? []) {
		if (cf.customFieldId === PRIO.id) d.prio = cf.selectedOptionIds?.[0] ?? null;
		else if (cf.customFieldId === EFFORT.id) d.effort = cf.selectedOptionIds?.[0] ?? null;
		else if (cf.customFieldId === COMP.id) d.comps = cf.selectedOptionIds ?? [];
		else if ('numberValue' in cf) d.points = cf.numberValue;
		else if ('textValue' in cf) d.customer = cf.textValue;
	}
	raw.updatedAt = new Date().toISOString();
	return { errors: [], workItem: render(raw) };
}

function applyCreate(input) {
	const type = typesById[input.workItemTypeId]?.name ?? 'Issue';
	const path = input.namespacePath;
	const isEpic = type === 'Epic';
	// Like GitLab: an epic lives in the group, everything else in one of its projects.
	if (isEpic ? path !== GROUP_PATH : !projects[path]) return { errors: ['Namespace not found'], workItem: null };
	const parent = input.hierarchyWidget?.parentId ?? null;
	if (isEpic && parent && items.get(parent)?.workItemType.name !== 'Epic') return { errors: ["Parent can't be assigned: an epic can only have an epic as its parent"], workItem: null };
	// Epics have no status widget; makeItem builds the group namespace, `acme/platform&12` reference and epic URL.
	const id = makeItem({ type, path, title: input.title, desc: input.description ?? '', status: isEpic ? undefined : (input.statusWidget?.status ?? S.todo), parent, assignees: input.assigneesWidget?.assigneeIds ?? [], labels: input.labelsWidget?.labelIds ?? [], updatedDays: 0 });
	const res = applyUpdate({ id, customFieldsWidget: isEpic ? [] : (input.customFieldsWidget ?? []), milestoneWidget: input.milestoneWidget, weightWidget: input.weightWidget, iterationWidget: input.iterationWidget, startAndDueDateWidget: input.startAndDueDateWidget });
	return res;
}

// ---- HTTP ---------------------------------------------------------------------------------------

const json = (res, status, body, headers = {}) => {
	res.writeHead(status, { 'content-type': 'application/json', ...headers });
	res.end(JSON.stringify(body));
};
const readBody = (req) =>
	new Promise((resolve) => {
		let s = '';
		req.on('data', (c) => (s += c));
		req.on('end', () => resolve(s));
	});

let writes = 0;
const server = createServer(async (req, res) => {
	const url = new URL(req.url, BASE);
	try {
		if (url.pathname === '/oauth/authorize') {
			const back = new URL(url.searchParams.get('redirect_uri'));
			back.searchParams.set('code', 'fake-code');
			back.searchParams.set('state', url.searchParams.get('state'));
			res.writeHead(302, { location: back.href });
			return res.end();
		}
		if (url.pathname === '/oauth/token') {
			await readBody(req);
			return json(res, 200, { access_token: `fake-access-${Date.now()}`, refresh_token: `fake-refresh-${Date.now()}`, expires_in: 7200, created_at: Math.floor(Date.now() / 1000), scope: SCOPE, token_type: 'Bearer' });
		}
		if (url.pathname === '/oauth/revoke') return json(res, 200, {});
		if (url.pathname === '/api/v4/user') return json(res, 200, { id: 101, username: 'alex', name: 'Alex Example' });
		if (url.pathname === '/api/v4/version') return json(res, 200, { version: '18.6.0-fake', revision: 'fake' });
		if (url.pathname === '/api/v4/personal_access_tokens/self') return json(res, 200, { scopes: ['read_api'] });
		if (url.pathname === '/__writes') return json(res, 200, { writes });
		if (url.pathname === '/api/graphql' && req.method === 'POST') {
			const body = JSON.parse(await readBody(req));
			const op = /(?:query|mutation)\s+(\w+)/.exec(body.query)?.[1] ?? (body.query.includes('metadata') ? 'Metadata' : '');
			const v = body.variables ?? {};
			switch (op) {
				case 'BoardCapabilities':
					return json(res, 200, { data: caps });
				case 'BoardSchema':
					return json(res, 200, { data: schema });
				case 'BoardGroupWorkItems':
				case 'BoardProjectWorkItems': {
					const want = v.state === 'closed' ? 'CLOSED' : 'OPEN';
					const all = [...items.values()]
						.filter((r) => r.state === want && (op === 'BoardGroupWorkItems' || r.namespace.fullPath === v.fullPath))
						.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
					const start = v.after ? Number(v.after) : 0;
					const page = all.slice(start, start + v.first);
					const more = start + v.first < all.length;
					const conn = { pageInfo: { hasNextPage: more, endCursor: more ? String(start + v.first) : null }, nodes: page.map(render) };
					return json(res, 200, { data: { [op === 'BoardGroupWorkItems' ? 'group' : 'project']: { workItems: conn } } });
				}
				case 'BoardUpdateWorkItem':
					writes++;
					// "[forbid]" in a title: GitLab's real no-permission shape (ResourceNotAvailable): a null
					// payload plus a top-level error, as opposed to "[reject]" (errors inside the payload).
					if (typeof v.input?.title === 'string' && v.input.title.includes('[forbid]'))
						return json(res, 200, {
							data: { workItemUpdate: null },
							errors: [{ message: "The resource that you are attempting to access does not exist or you don't have permission to perform this action", path: ['workItemUpdate'] }]
						});
					return json(res, 200, { data: { workItemUpdate: applyUpdate(v.input) } });
				case 'BoardCreateWorkItem':
					writes++;
					return json(res, 200, { data: { workItemCreate: applyCreate(v.input) } });
				case 'Metadata':
					return json(res, 200, { data: { metadata: { version: '18.6.0-fake', revision: 'fake', enterprise: true } } });
				case 'Describe':
					return json(res, 200, { data: { __type: null } });
				default:
					return json(res, 200, { errors: [{ message: `fake-gitlab: unknown operation ${op}` }] });
			}
		}
		json(res, 404, { message: '404 Not Found' });
	} catch (err) {
		console.error(err);
		json(res, 500, { message: String(err) });
	}
});

server.listen(PORT, () => console.log(`fake GitLab on ${BASE} (${items.size} work items)`));
