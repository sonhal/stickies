/**
 * GitLab GraphQL responses → the board's own model (src/lib/fields/types.ts).
 *
 * This file and queries.ts are the only places that know GitLab's shapes. Everything is defensive:
 * a missing widget or an unexpected value drops that one value, never the item or the page.
 * Shapes marked VERIFY(phase0) are listed in the README under "Things to verify against your GitLab".
 */
import { MARKDOWN_INPUT_MAX, markdownToText, truncate } from '$lib/text';
import { PARENT_NOT_LOADED } from '$lib/fields/registry';
import {
	type FieldDef,
	type FieldKey,
	type FieldRegistry,
	type FieldValue,
	type OptionDef,
	type Person,
	type ProjectRef,
	type StatusCategory,
	type WorkItem,
	type WorkItemTypeDef,
	STATUS_CATEGORIES
} from '$lib/fields/types';

/** Enough for a standup read-through; the full text is one click away in GitLab. */
export const DESCRIPTION_MAX_CHARS = 2500;

// ---- Raw shapes (what we expect GitLab to send) -----------------------------------------------

export interface Conn<T> {
	nodes?: (T | null)[] | null;
	pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
}
interface RawUser {
	id: string;
	username: string;
	name: string;
}
interface RawLabel {
	id: string;
	title: string;
	color?: string | null;
}
interface RawStatus {
	id: string;
	name: string;
	color?: string | null;
	category?: string | null;
}
interface RawMilestone {
	id: string;
	title: string;
	dueDate?: string | null;
}
interface RawIteration {
	id: string;
	title?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	iterationCadence?: { id: string; title: string } | null;
}
interface RawCustomFieldRef {
	id: string;
	name: string;
	fieldType: string;
}
/** VERIFY(phase0): one entry per field; select values in selectedOptions, others in `value` */
interface RawCustomFieldValue {
	customField?: RawCustomFieldRef | null;
	selectedOptions?: { id: string; value: string }[] | null;
	/** Aliases of each type's `value` (see queries.ts): the types differ, so they can't share a key */
	numberValue?: unknown;
	textValue?: unknown;
	dateValue?: unknown;
}
interface RawWidget {
	type?: string;
	description?: string | null;
	assignees?: Conn<RawUser> | null;
	labels?: Conn<RawLabel> | null;
	milestone?: RawMilestone | null;
	iteration?: RawIteration | null;
	weight?: number | null;
	startDate?: string | null;
	dueDate?: string | null;
	parent?: { id: string; title?: string | null; state?: string | null; workItemType?: { name: string } | null } | null;
	rolledUpCountsByType?: { workItemType?: { name: string } | null; countsByState?: { all?: number; closed?: number } | null }[] | null;
	status?: RawStatus | null;
	customFieldValues?: RawCustomFieldValue[] | null;
}
export interface RawWorkItem {
	id: string;
	iid: string | number;
	title: string;
	state: string;
	createdAt: string;
	updatedAt: string;
	closedAt?: string | null;
	webUrl?: string | null;
	reference?: string | null;
	workItemType?: { id: string; name: string } | null;
	namespace?: { id: string; fullPath: string; name?: string } | null;
	widgets?: RawWidget[] | null;
	userPermissions?: { deleteWorkItem?: boolean | null } | null;
}
export interface RawCustomFieldDef {
	id: string;
	name: string;
	fieldType: string;
	active?: boolean;
	selectOptions?: { id: string; value: string }[] | null;
	workItemTypes?: { id: string; name: string }[] | null;
}
export interface RawSchema {
	currentUser?: RawUser | null;
	group?: {
		id: string;
		fullPath: string;
		name?: string;
		customFields?: Conn<RawCustomFieldDef> | null;
		workItemTypes?: Conn<{
			id: string;
			name: string;
			widgetDefinitions?: { type?: string; allowedStatuses?: RawStatus[] | null }[] | null;
		}> | null;
		projects?: Conn<{ id: string; name: string; fullPath: string; webUrl?: string | null; archived?: boolean }> | null;
		labels?: Conn<RawLabel> | null;
		milestones?: Conn<RawMilestone> | null;
		iterations?: Conn<RawIteration> | null;
		groupMembers?: Conn<{ user?: RawUser | null }> | null;
	} | null;
}

// ---- Small helpers ------------------------------------------------------------------------------

/** Only pass through http(s) links, so a weird value can never become a javascript: href. */
export function safeUrl(value: string | undefined | null): string | null {
	if (!value) return null;
	try {
		const u = new URL(value);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
}

/** Colors end up in style attributes: only accept plain hex. */
export function safeColor(value: string | undefined | null): string | undefined {
	return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined;
}

/** "gid://gitlab/Issuables::CustomField/7" → "7" */
export function gidTail(gid: string): string {
	const i = gid.lastIndexOf('/');
	return i === -1 ? gid : gid.slice(i + 1);
}

const nodes = <T>(c: Conn<T> | null | undefined): T[] => (c?.nodes ?? []).filter((n): n is T => !!n);

/** VERIFY(phase0): category enum values. Accepts TO_DO, to_do, toDo, "To do", CANCELLED… */
export function statusCategory(raw: string | null | undefined): StatusCategory | undefined {
	if (!raw) return undefined;
	const k = raw.toLowerCase().replace(/[^a-z]/g, '');
	const map: Record<string, StatusCategory> = {
		triage: 'triage',
		todo: 'toDo',
		inprogress: 'inProgress',
		done: 'done',
		canceled: 'canceled',
		cancelled: 'canceled'
	};
	return map[k];
}

const CATEGORY_ORDER = (c: StatusCategory | undefined) => (c ? STATUS_CATEGORIES.indexOf(c) : 2);

/** VERIFY(phase0): custom field type enum values */
export function customFieldKind(fieldType: string): FieldDef['kind'] | null {
	switch (fieldType.toUpperCase()) {
		case 'SINGLE_SELECT':
			return 'singleSelect';
		case 'MULTI_SELECT':
			return 'multiSelect';
		case 'NUMBER':
			return 'number';
		case 'TEXT':
			return 'text';
		case 'DATE':
			return 'date';
		default:
			return null;
	}
}

export const customKey = (gid: string): FieldKey => `custom:${gidTail(gid)}`;

// ---- Work items ---------------------------------------------------------------------------------

/** Option labels seen on items. Merged into the registry so an option missing from the schema still has a name. */
export interface Seen {
	statuses: Map<string, OptionDef>;
	labels: Map<string, OptionDef>;
	milestones: Map<string, OptionDef>;
	iterations: Map<string, OptionDef>;
	people: Map<string, Person>;
	types: Map<string, WorkItemTypeDef>;
	customOptions: Map<FieldKey, { def: RawCustomFieldRef; options: Map<string, string> }>;
	/** Parents named on items, with the title GitLab sent: covers parents the board didn't load */
	parents: Map<string, { title: string | null; closed: boolean; isEpic: boolean }>;
}

export function emptySeen(): Seen {
	return {
		statuses: new Map(),
		labels: new Map(),
		milestones: new Map(),
		iterations: new Map(),
		people: new Map(),
		types: new Map(),
		customOptions: new Map(),
		parents: new Map()
	};
}

export interface NormalizeContext {
	/** Full paths of the group's projects, to tell a project namespace from a group one */
	projectPaths: Set<string>;
	seen?: Seen;
}

function isoDate(v: unknown): string | null {
	return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null;
}

export function normalizeWorkItem(raw: RawWorkItem, ctx: NormalizeContext): WorkItem {
	const seen = ctx.seen ?? emptySeen();
	const values: WorkItem['values'] = {};
	const widgets = raw.widgets ?? [];
	let description = '';
	let parentId: string | null = null;
	let progress: WorkItem['progress'] = null;

	const typeName = raw.workItemType?.name ?? 'Item';
	if (raw.workItemType) seen.types.set(raw.workItemType.name, { id: raw.workItemType.id, name: raw.workItemType.name });
	values['native:type'] = { kind: 'option', id: typeName };

	for (const w of widgets) {
		if (!w) continue;
		if (typeof w.description === 'string') description = w.description;
		if (w.assignees) {
			const people = nodes(w.assignees);
			for (const p of people) seen.people.set(p.id, { id: p.id, name: p.name, username: p.username });
			values['native:assignees'] = { kind: 'people', ids: people.map((p) => p.id) };
		}
		if (w.labels) {
			const labels = nodes(w.labels);
			for (const l of labels)
				if (!seen.labels.has(l.id))
					seen.labels.set(l.id, { id: l.id, label: l.title, position: 0, color: safeColor(l.color) });
			values['native:labels'] = { kind: 'options', ids: labels.map((l) => l.id) };
		}
		if (w.milestone) {
			seen.milestones.set(w.milestone.id, {
				id: w.milestone.id,
				label: w.milestone.title,
				position: 0,
				hint: w.milestone.dueDate ?? undefined
			});
			values['native:milestone'] = { kind: 'option', id: w.milestone.id };
		}
		if (w.iteration) {
			seen.iterations.set(w.iteration.id, iterationOption(w.iteration, 0));
			values['native:iteration'] = { kind: 'option', id: w.iteration.id };
		}
		if (w.type === 'WEIGHT' || 'weight' in w) {
			if (typeof w.weight === 'number') values['native:weight'] = { kind: 'number', value: w.weight };
		}
		if ('startDate' in w || 'dueDate' in w) {
			const s = isoDate(w.startDate);
			const d = isoDate(w.dueDate);
			if (s) values['native:startDate'] = { kind: 'date', value: s };
			if (d) values['native:dueDate'] = { kind: 'date', value: d };
		}
		if (w.parent?.id) {
			parentId = w.parent.id;
			values['native:parent'] = { kind: 'ref', id: w.parent.id };
			const title = typeof w.parent.title === 'string' && w.parent.title ? w.parent.title : null;
			const prev = seen.parents.get(w.parent.id);
			seen.parents.set(w.parent.id, {
				title: title ?? prev?.title ?? null,
				closed: String(w.parent.state ?? '').toUpperCase() === 'CLOSED' || !!prev?.closed,
				isEpic: String(w.parent.workItemType?.name ?? '').toLowerCase() === 'epic' || !!prev?.isEpic
			});
		}
		if (Array.isArray(w.rolledUpCountsByType)) {
			let total = 0;
			let closed = 0;
			for (const r of w.rolledUpCountsByType) {
				total += Number(r?.countsByState?.all ?? 0) || 0;
				closed += Number(r?.countsByState?.closed ?? 0) || 0;
			}
			progress = { total, closed };
		}
		if (w.status) {
			const s = w.status;
			if (!seen.statuses.has(s.id))
				seen.statuses.set(s.id, {
					id: s.id,
					label: s.name,
					position: 0,
					color: safeColor(s.color),
					category: statusCategory(s.category)
				});
			values['native:status'] = { kind: 'option', id: s.id };
		}
		if (Array.isArray(w.customFieldValues)) {
			for (const cv of w.customFieldValues) {
				const v = customValue(cv, seen);
				if (v) values[v.key] = v.value;
			}
		}
	}

	const ns = raw.namespace;
	const isProject = !!ns && (ctx.projectPaths.has(ns.fullPath) || /Project/.test(ns.id));
	const projectId = isProject ? ns!.fullPath : null;
	if (projectId) values['native:project'] = { kind: 'ref', id: projectId };

	values['native:createdAt'] = { kind: 'date', value: raw.createdAt };
	values['native:updatedAt'] = { kind: 'date', value: raw.updatedAt };

	const desc = truncate(markdownToText(description), DESCRIPTION_MAX_CHARS);
	// Only the first MARKDOWN_INPUT_MAX characters are converted: say so even if the text came out short
	if ((description?.length ?? 0) > MARKDOWN_INPUT_MAX) desc.truncated = true;
	const iid = Number(raw.iid);
	return {
		id: raw.id,
		iid: Number.isFinite(iid) ? iid : 0,
		ref: raw.reference ?? `#${raw.iid}`,
		type: typeName,
		title: raw.title,
		url: safeUrl(raw.webUrl),
		description: desc.text,
		descriptionTruncated: desc.truncated,
		state: String(raw.state).toUpperCase() === 'CLOSED' ? 'closed' : 'open',
		closedAt: raw.closedAt ?? null,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		projectId,
		parentId,
		progress,
		values,
		// Only an explicit yes counts: a missing or odd value hides the delete action rather than offering one that fails.
		canDelete: raw.userPermissions?.deleteWorkItem === true
	};
}

function iterationOption(it: RawIteration, position: number): OptionDef {
	const span = it.startDate && it.dueDate ? `${it.startDate} – ${it.dueDate}` : undefined;
	const label = it.title || (it.iterationCadence?.title ? `${it.iterationCadence.title} ${span ?? ''}`.trim() : span ?? 'Iteration');
	return { id: it.id, label, position, hint: it.iterationCadence?.title ?? span };
}

function customValue(cv: RawCustomFieldValue, seen: Seen): { key: FieldKey; value: FieldValue } | null {
	const def = cv?.customField;
	if (!def?.id) return null;
	const key = customKey(def.id);
	const kind = customFieldKind(def.fieldType);
	if (kind === 'singleSelect' || kind === 'multiSelect') {
		const opts = (cv.selectedOptions ?? []).filter((o) => o?.id);
		let entry = seen.customOptions.get(key);
		if (!entry) seen.customOptions.set(key, (entry = { def, options: new Map() }));
		for (const o of opts) entry.options.set(o.id, o.value);
		if (opts.length === 0) return null;
		return kind === 'singleSelect'
			? { key, value: { kind: 'option', id: opts[0].id } }
			: { key, value: { kind: 'options', ids: opts.map((o) => o.id) } };
	}
	if (kind === 'number') {
		const raw = cv.numberValue;
		const n = typeof raw === 'number' ? raw : Number(raw);
		return raw === null || raw === undefined || raw === '' || !Number.isFinite(n) ? null : { key, value: { kind: 'number', value: n } };
	}
	if (kind === 'date') {
		const d = isoDate(cv.dateValue);
		return d ? { key, value: { kind: 'date', value: d } } : null;
	}
	// text, and any type the board doesn't know yet: shown read-only as text
	const raw = cv.textValue ?? cv.numberValue ?? cv.dateValue;
	if (raw === null || raw === undefined || raw === '') return null;
	const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
	return { key, value: { kind: 'text', value: text.slice(0, 1000) } };
}

// ---- Schema → FieldRegistry ---------------------------------------------------------------------

export const NATIVE_NAMES: Record<string, string> = {
	'native:status': 'Status',
	'native:assignees': 'Assignees',
	'native:labels': 'Labels',
	'native:weight': 'Weight',
	'native:dueDate': 'Due date',
	'native:startDate': 'Start date',
	'native:milestone': 'Milestone',
	'native:iteration': 'Iteration',
	'native:project': 'Project',
	'native:parent': 'Parent',
	'native:epic': 'Epic',
	'native:type': 'Type',
	'native:createdAt': 'Created',
	'native:updatedAt': 'Updated'
};

function native(
	key: FieldKey,
	kind: FieldDef['kind'],
	extra: Partial<FieldDef> = {}
): FieldDef {
	return {
		key,
		name: NATIVE_NAMES[key] ?? key,
		kind,
		ordered: kind === 'number' || kind === 'date' || kind === 'status',
		editable: false,
		appliesTo: [],
		...extra
	};
}

export function normalizeSchema(raw: RawSchema, opts: { iterations: boolean }): FieldRegistry {
	const g = raw.group;
	const warnings: string[] = [];
	if (!g) warnings.push('The group was not found, or you cannot see it.');

	const people = new Map<string, Person>();
	for (const m of nodes(g?.groupMembers)) if (m.user) people.set(m.user.id, pick(m.user));
	if (raw.currentUser) people.set(raw.currentUser.id, pick(raw.currentUser));

	const projects: ProjectRef[] = nodes(g?.projects)
		.filter((p) => !p.archived)
		.map((p) => ({ id: p.fullPath, name: p.name, fullPath: p.fullPath, url: safeUrl(p.webUrl) }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const types: WorkItemTypeDef[] = nodes(g?.workItemTypes).map((t) => ({ id: t.id, name: t.name }));

	// Allowed statuses: union over all types, deduped by id, in category order then GitLab order.
	const statusOpts = new Map<string, OptionDef & { first: number }>();
	const statusTypes: string[] = [];
	let n = 0;
	for (const t of nodes(g?.workItemTypes)) {
		for (const d of t.widgetDefinitions ?? []) {
			if (!d?.allowedStatuses) continue;
			if (d.allowedStatuses.length) statusTypes.push(t.name);
			for (const s of d.allowedStatuses) {
				if (!s?.id || statusOpts.has(s.id)) continue;
				statusOpts.set(s.id, {
					id: s.id,
					label: s.name,
					position: 0,
					color: safeColor(s.color),
					category: statusCategory(s.category),
					first: n++
				});
			}
		}
	}
	const statuses = [...statusOpts.values()]
		.sort((a, b) => CATEGORY_ORDER(a.category) - CATEGORY_ORDER(b.category) || a.first - b.first)
		.map(({ first: _first, ...o }, i) => ({ ...o, position: i }));

	const labels: OptionDef[] = nodes(g?.labels)
		.map((l) => ({ id: l.id, label: l.title, position: 0, color: safeColor(l.color) }))
		.sort((a, b) => a.label.localeCompare(b.label))
		.map((o, i) => ({ ...o, position: i }));

	const milestones: OptionDef[] = nodes(g?.milestones)
		.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title))
		.map((m, i) => ({ id: m.id, label: m.title, position: i, hint: m.dueDate ?? undefined }));

	const iterations: OptionDef[] = nodes(g?.iterations)
		.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''))
		.map((it, i) => iterationOption(it, i));

	const fields: FieldDef[] = [
		native('native:status', 'status', { options: statuses, editable: true, appliesTo: statusTypes }),
		native('native:assignees', 'people', { editable: true }),
		native('native:labels', 'multiSelect', { options: labels, editable: true, scopedExclusive: true }),
		native('native:weight', 'number', { editable: true }),
		native('native:startDate', 'date', { editable: true }),
		native('native:dueDate', 'date', { editable: true }),
		native('native:milestone', 'singleSelect', { options: milestones, editable: true, ordered: false }),
		...(opts.iterations
			? [native('native:iteration', 'singleSelect', { options: iterations, editable: true, ordered: false })]
			: []),
		native('native:project', 'ref', { options: projects.map((p, i) => ({ id: p.id, label: p.name, position: i, hint: p.fullPath })) }),
		native('native:parent', 'ref', { options: [], editable: true }),
		// Derived, read-only: the nearest epic above an item (see src/lib/fields/epic.ts). Set the parent to change it.
		native('native:epic', 'ref', { options: [] }),
		native('native:type', 'singleSelect', {
			options: types.map((t, i) => ({ id: t.name, label: t.name, position: i })),
			ordered: false
		}),
		native('native:createdAt', 'date'),
		native('native:updatedAt', 'date')
	];

	for (const cf of nodes(g?.customFields)) {
		if (cf.active === false) continue;
		fields.push(customFieldDef(cf));
	}

	return {
		fields,
		people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
		projects,
		types,
		currentUserId: raw.currentUser?.id ?? null,
		warnings
	};
}

export function customFieldDef(cf: RawCustomFieldDef): FieldDef {
	const kind = customFieldKind(cf.fieldType);
	const base = {
		key: customKey(cf.id),
		name: cf.name,
		appliesTo: (cf.workItemTypes ?? []).map((t) => t.name)
	};
	if (!kind) {
		// A type this board doesn't know yet: still visible, as read-only text.
		return { ...base, kind: 'text', ordered: false, editable: false, rawType: cf.fieldType };
	}
	const options =
		kind === 'singleSelect' || kind === 'multiSelect'
			? (cf.selectOptions ?? []).map((o, i) => ({ id: o.id, label: o.value, position: i }))
			: undefined;
	return {
		...base,
		kind,
		options,
		ordered: kind === 'singleSelect' || kind === 'number' || kind === 'date',
		editable: true
	};
}

const pick = (u: RawUser): Person => ({ id: u.id, name: u.name, username: u.username });

/**
 * Add what the items know but the schema didn't list: statuses/labels/milestones only seen on
 * items, assignees who aren't group members, epics (as parent options), and custom fields that
 * are no longer active but still have values. Returns a new registry; the input is not changed.
 */
export function mergeSeen(reg: FieldRegistry, seen: Seen, items: WorkItem[]): FieldRegistry {
	const fields: FieldDef[] = reg.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined }));
	const byKey = new Map(fields.map((f) => [f.key, f]));
	const addOptions = (key: FieldKey, extra: Iterable<OptionDef>) => {
		const f = byKey.get(key);
		if (!f) return;
		const opts = f.options ?? (f.options = []);
		const have = new Set(opts.map((o) => o.id));
		for (const o of extra) if (!have.has(o.id)) opts.push({ ...o, position: opts.length });
	};
	addOptions('native:status', seen.statuses.values());
	addOptions('native:labels', seen.labels.values());
	addOptions('native:milestone', seen.milestones.values());
	addOptions('native:iteration', seen.iterations.values());
	addOptions('native:type', [...seen.types.values()].map((t) => ({ id: t.name, label: t.name, position: 0 })));

	// Status statuses only seen on items must still sort by category.
	const status = byKey.get('native:status');
	if (status?.options) {
		status.options = status.options
			.map((o, i) => ({ o, i }))
			.sort((a, b) => CATEGORY_ORDER(a.o.category) - CATEGORY_ORDER(b.o.category) || a.i - b.i)
			.map(({ o }, i) => ({ ...o, position: i }));
	}
	const labels = byKey.get('native:labels');
	if (labels?.options) {
		labels.options = labels.options.sort((a, b) => a.label.localeCompare(b.label)).map((o, i) => ({ ...o, position: i }));
	}

	// Parent options: every item that is a parent, plus every epic-type item.
	const parent = byKey.get('native:parent');
	if (parent) {
		const parentIds = new Set(items.map((i) => i.parentId).filter((x): x is string => !!x));
		const candidates = items
			.filter((i) => parentIds.has(i.id) || i.type.toLowerCase() === 'epic')
			.sort((a, b) => a.title.localeCompare(b.title));
		const loaded = new Set(candidates.map((i) => i.id));
		// Parents the board didn't load (e.g. an epic closed long ago that still has open issues)
		// still get a real option, so grouping by parent shows their title and never an unknown key.
		const unloaded = [...seen.parents]
			.filter(([id]) => !loaded.has(id))
			.map(([id, p]) => ({ id, label: p.title ? (p.closed ? `${p.title} (closed)` : p.title) : PARENT_NOT_LOADED }))
			.sort((a, b) => a.label.localeCompare(b.label));
		parent.options = [
			...candidates.map((i) => ({ id: i.id, label: i.title, hint: i.ref })),
			...unloaded
		].map((o, n) => ({ ...o, position: n }));
	}

	// Epic options: loaded epics, plus epics named as a parent but not loaded (e.g. closed long ago).
	const epic = byKey.get('native:epic');
	if (epic) {
		const loadedEpics = items.filter((i) => i.type.toLowerCase() === 'epic');
		const have = new Set(loadedEpics.map((i) => i.id));
		const extra = [...seen.parents]
			.filter(([id, p]) => p.isEpic && !have.has(id))
			.map(([id, p]) => ({ id, label: p.title ? (p.closed ? `${p.title} (closed)` : p.title) : PARENT_NOT_LOADED }));
		epic.options = [...loadedEpics.map((i) => ({ id: i.id, label: i.title, hint: i.ref })), ...extra]
			.sort((a, b) => a.label.localeCompare(b.label))
			.map((o, n) => ({ ...o, position: n }));
	}

	// Custom fields with values but no active definition: show them, read-only.
	for (const [key, entry] of seen.customOptions) {
		const f = byKey.get(key);
		if (f) {
			addOptions(key, [...entry.options].map(([id, label]) => ({ id, label, position: 0 })));
			continue;
		}
		const def = customFieldDef({ id: entry.def.id, name: entry.def.name, fieldType: entry.def.fieldType });
		def.editable = false;
		def.options = [...entry.options].map(([id, label], i) => ({ id, label, position: i }));
		fields.push(def);
		byKey.set(key, def);
	}

	const people = new Map(reg.people.map((p) => [p.id, p]));
	for (const p of seen.people.values()) if (!people.has(p.id)) people.set(p.id, p);

	const types = [...reg.types];
	for (const t of seen.types.values()) if (!types.some((x) => x.name === t.name)) types.push(t);

	return {
		...reg,
		fields,
		types,
		people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
	};
}
