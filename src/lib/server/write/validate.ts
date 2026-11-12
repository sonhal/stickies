/**
 * Write validation: browser input → an allowlisted GitLab mutation input.
 *
 * The browser never sends GraphQL. It sends `{ itemId, field, value }` (or a create request).
 * Each one is checked against the viewer's FieldRegistry and items: the item must be on their
 * board, the field must exist, be editable and apply to the item's type, and the value must be one
 * of that field's options (or a valid number/date/text). Only then is a widget input built.
 * The two mutations it can produce are in src/lib/server/gitlab/queries.ts. Pure; unit-tested.
 */
import * as v from 'valibot';
import { appliesTo, optionById } from '$lib/fields/registry';
import { labelScope, scopedConflict, type WriteValue } from '$lib/fields/apply';
import type { FieldDef, FieldKey, FieldRegistry, WorkItem } from '$lib/fields/types';
import { mergeWidgets, widgetInput as W } from '../gitlab/mutations';

export const TITLE_MAX = 255;
export const TEXT_MAX = 1024;
export const DESCRIPTION_MAX = 20_000;

const ItemId = v.pipe(v.string(), v.maxLength(120), v.regex(/^gid:\/\/gitlab\/WorkItem\/\d+$/));
const FieldName = v.pipe(v.string(), v.maxLength(80), v.regex(/^(title|native:[A-Za-z]+|custom:\d+)$/));
const Value = v.union([
	v.null(),
	v.pipe(v.string(), v.maxLength(DESCRIPTION_MAX)),
	v.pipe(v.number(), v.finite()),
	v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(50))
]);

const UpdateSchema = v.strictObject({ itemId: ItemId, field: FieldName, value: Value });

const CreateSchema = v.strictObject({
	title: v.string(),
	description: v.optional(v.pipe(v.string(), v.maxLength(DESCRIPTION_MAX))),
	// Optional here because an Epic has no project; planCreate requires it for every other type.
	projectId: v.optional(v.pipe(v.string(), v.maxLength(300))),
	type: v.optional(v.pipe(v.string(), v.maxLength(60))),
	parentId: v.optional(v.nullable(ItemId)),
	values: v.optional(v.pipe(v.record(FieldName, Value), v.check((r) => Object.keys(r).length <= 30, 'Too many values')))
});

export type WriteError = { ok: false; status: 400 | 403 | 404; error: string };
export type Widgets = Record<string, unknown>;

const fail = (error: string, status: WriteError['status'] = 400): WriteError => ({ ok: false, status, error });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function optionValue(field: FieldDef, value: WriteValue, clearable: boolean): { ok: true; id: string | null } | WriteError {
	if (value === null) return clearable ? { ok: true, id: null } : fail(`${field.name} can't be empty`);
	if (typeof value !== 'string') return fail(`${field.name} needs one option`);
	if (!optionById(field, value)) return fail(`That option doesn't exist for ${field.name}`);
	return { ok: true, id: value };
}

function optionList(field: FieldDef, value: WriteValue, known: (id: string) => boolean): { ok: true; ids: string[] } | WriteError {
	if (value === null) return { ok: true, ids: [] };
	if (!Array.isArray(value)) return fail(`${field.name} needs a list`);
	const ids = [...new Set(value)];
	const bad = ids.find((id) => !known(id));
	if (bad !== undefined) return fail(`That option doesn't exist for ${field.name}`);
	return { ok: true, ids };
}

function isDescendant(items: Map<string, WorkItem>, candidate: string, of: string): boolean {
	let cur = items.get(candidate);
	for (let d = 0; cur && d < 10; d++) {
		if (cur.id === of) return true;
		cur = cur.parentId ? items.get(cur.parentId) : undefined;
	}
	return false;
}

/**
 * Widget input for one field. `item` is null on create (no current value to diff against).
 * Returns the partial WorkItemUpdateInput / WorkItemCreateInput.
 */
export function widgetFor(
	reg: FieldRegistry,
	items: Map<string, WorkItem>,
	item: WorkItem | null,
	field: FieldDef,
	value: WriteValue,
	mode: 'update' | 'create'
): { ok: true; widgets: Widgets } | WriteError {
	switch (field.key) {
		case 'native:status': {
			const r = optionValue(field, value, false);
			return r.ok ? { ok: true, widgets: W.status(r.id) } : r;
		}
		case 'native:assignees': {
			const r = optionList(field, value, (id) => reg.people.some((p) => p.id === id));
			if (!r.ok) return r;
			if (r.ids.length > 20) return fail('Too many assignees');
			return { ok: true, widgets: W.assignees(r.ids) };
		}
		case 'native:labels': {
			const r = optionList(field, value, (id) => !!optionById(field, id));
			if (!r.ok) return r;
			const conflict = scopedConflict(field, r.ids);
			if (conflict) return fail(`Only one "${conflict}::" label can be set`);
			if (mode === 'create') return { ok: true, widgets: W.labelsCreate(r.ids) };
			const cur = item?.values['native:labels'];
			const before = cur?.kind === 'options' ? cur.ids : [];
			return {
				ok: true,
				widgets: W.labelsUpdate(
					r.ids.filter((id) => !before.includes(id)),
					before.filter((id) => !r.ids.includes(id))
				)
			};
		}
		case 'native:weight': {
			if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1_000_000))
				return fail('Weight must be a whole number of 0 or more');
			return { ok: true, widgets: W.weight(value) };
		}
		case 'native:startDate':
		case 'native:dueDate': {
			if (value !== null && (typeof value !== 'string' || !validDate(value))) return fail('Dates must look like 2026-11-30');
			const k = field.key === 'native:startDate' ? 'startDate' : 'dueDate';
			return { ok: true, widgets: W.date(k, value) };
		}
		case 'native:milestone': {
			const r = optionValue(field, value, true);
			return r.ok ? { ok: true, widgets: W.milestone(r.id) } : r;
		}
		case 'native:iteration': {
			const r = optionValue(field, value, true);
			return r.ok ? { ok: true, widgets: W.iteration(r.id) } : r;
		}
		case 'native:parent': {
			if (value === null) return { ok: true, widgets: W.parent(null) };
			if (typeof value !== 'string' || !items.has(value)) return fail('The new parent must be on the board');
			if (item && (value === item.id || isDescendant(items, value, item.id))) return fail("An item can't be its own parent");
			return { ok: true, widgets: W.parent(value) };
		}
	}
	if (!field.key.startsWith('custom:')) return fail(`${field.name} can't be edited from the board`);
	switch (field.kind) {
		case 'singleSelect': {
			const r = optionValue(field, value, true);
			return r.ok ? { ok: true, widgets: W.custom(field.key, W.customSelect(r.id ? [r.id] : [])) } : r;
		}
		case 'multiSelect': {
			const r = optionList(field, value, (id) => !!optionById(field, id));
			return r.ok ? { ok: true, widgets: W.custom(field.key, W.customSelect(r.ids)) } : r;
		}
		case 'number':
			if (value !== null && typeof value !== 'number') return fail(`${field.name} must be a number`);
			return { ok: true, widgets: W.custom(field.key, W.customNumber(value)) };
		case 'text':
			if (value !== null && (typeof value !== 'string' || value.length > TEXT_MAX)) return fail(`${field.name} must be text up to ${TEXT_MAX} characters`);
			return { ok: true, widgets: W.custom(field.key, W.customText(value)) };
		case 'date':
			if (value !== null && (typeof value !== 'string' || !validDate(value))) return fail('Dates must look like 2026-11-30');
			return { ok: true, widgets: W.custom(field.key, W.customDate(value)) };
	}
	return fail(`${field.name} can't be edited from the board`);
}

function checkField(reg: FieldRegistry, key: string, type: string): { ok: true; field: FieldDef } | WriteError {
	// Exact key only: the browser always sends keys, never names.
	const field = reg.fields.find((f) => f.key === (key as FieldKey));
	if (!field) return fail('That field no longer exists in GitLab');
	if (!field.editable) return fail(`${field.name} can't be edited from the board`);
	if (!appliesTo(field, type)) return fail(`${field.name} doesn't apply to a ${type}`);
	return { ok: true, field };
}

function checkTitle(title: unknown): { ok: true; title: string } | WriteError {
	if (typeof title !== 'string') return fail('The title must be text');
	const t = title.replace(/[\r\n]+/g, ' ').trim();
	if (!t) return fail("The title can't be empty");
	if (t.length > TITLE_MAX) return fail(`The title can be at most ${TITLE_MAX} characters`);
	return { ok: true, title: t };
}

export interface UpdatePlan {
	ok: true;
	item: WorkItem;
	field: FieldDef | null;
	input: Record<string, unknown>;
}

export function planUpdate(raw: unknown, reg: FieldRegistry, items: WorkItem[]): UpdatePlan | WriteError {
	const parsed = v.safeParse(UpdateSchema, raw);
	if (!parsed.success) return fail('Invalid request');
	const { itemId, field: key, value } = parsed.output;
	const byId = new Map(items.map((i) => [i.id, i]));
	const item = byId.get(itemId);
	if (!item) return fail('That item is not on your board (it may have been moved or you lost access)', 404);

	if (key === 'title') {
		const t = checkTitle(value);
		return t.ok ? { ok: true, item, field: null, input: W.title(item.id, t.title) } : t;
	}
	const f = checkField(reg, key, item.type);
	if (!f.ok) return f;
	const w = widgetFor(reg, byId, item, f.field, value, 'update');
	if (!w.ok) return w;
	return { ok: true, item, field: f.field, input: W.update(item.id, w.widgets) };
}

export interface CreatePlan {
	ok: true;
	input: Record<string, unknown>;
}

/**
 * `groupPath` is the board's group full path, resolved by the server (never sent by the browser).
 * An Epic is created in that group; every other type is created in one of the group's projects.
 */
export function planCreate(raw: unknown, reg: FieldRegistry, items: WorkItem[], groupPath: string): CreatePlan | WriteError {
	const parsed = v.safeParse(CreateSchema, raw);
	if (!parsed.success) return fail('Invalid request');
	const c = parsed.output;
	const t = checkTitle(c.title);
	if (!t.ok) return t;
	const typeName = c.type ?? 'Issue';
	const type = reg.types.find((x) => x.name.toLowerCase() === typeName.toLowerCase());
	if (!type) return fail(`Unknown work item type "${typeName}"`);
	const isEpic = type.name.toLowerCase() === 'epic';
	const byId = new Map(items.map((i) => [i.id, i]));

	let namespacePath: string;
	if (isEpic) {
		// A project sent along with an epic is ignored: the epic always goes to the board's group.
		if (!groupPath) return fail('The group is not known yet. Reload the board and try again.');
		namespacePath = groupPath;
		// GitLab only lets an epic sit under another epic.
		if (c.parentId && byId.get(c.parentId)?.type.toLowerCase() !== 'epic') return fail('The parent of an epic must be an epic on the board');
	} else {
		const project = reg.projects.find((p) => p.id === c.projectId);
		if (!project) return fail('Pick one of the group’s projects');
		namespacePath = project.fullPath;
	}

	const description = c.description?.trim() ? neutralizeQuickActions(c.description) : undefined;
	const input: Record<string, unknown> = W.create(namespacePath, type.id, t.title, description);

	const values: Record<string, WriteValue> = { ...(c.values ?? {}) };
	if (c.parentId) values['native:parent'] = c.parentId;
	for (const [key, value] of Object.entries(values)) {
		if (key === 'title' || value === null) continue;
		const f = checkField(reg, key, type.name);
		if (!f.ok) return f;
		const w = widgetFor(reg, byId, null, f.field, value, 'create');
		if (!w.ok) return w;
		mergeWidgets(input, w.widgets);
	}
	return { ok: true, input };
}

export { labelScope };

/**
 * GitLab runs quick actions (`/move`, `/assign`, `/label`, `/clone` …) written at the start of a line
 * in a new issue's description. That would let a create request do things the board's mutation
 * allowlist forbids, such as moving the issue out of the group (review M4). Escaping the slash
 * (`\/move`) stops GitLab from running it, and Markdown still displays it as `/move`.
 * Lines indented 4+ spaces are code blocks, which GitLab doesn't interpret, so they're left alone.
 */
export function neutralizeQuickActions(text: string): string {
	return text.replace(/^( {0,3})\//gm, '$1\\/');
}
