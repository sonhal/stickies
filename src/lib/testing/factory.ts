/** Builders for unit tests. Not imported by app code. */
import type { FieldDef, FieldRegistry, FieldValue, OptionDef, WorkItem } from '$lib/fields/types';

export function opts(prefix: string, labels: string[]): OptionDef[] {
	return labels.map((label, i) => ({ id: `${prefix}${i + 1}`, label, position: i }));
}

export function selectField(key: string, name: string, labels: string[], extra: Partial<FieldDef> = {}): FieldDef {
	return {
		key: key as FieldDef['key'],
		name,
		kind: 'singleSelect',
		options: opts(`${key}/o`, labels),
		ordered: true,
		editable: true,
		appliesTo: [],
		...extra
	};
}

export const STATUS: FieldDef = {
	key: 'native:status',
	name: 'Status',
	kind: 'status',
	ordered: true,
	editable: true,
	appliesTo: ['Issue', 'Task'],
	options: [
		{ id: 's-triage', label: 'Triage', position: 0, category: 'triage' },
		{ id: 's-todo', label: 'To do', position: 1, category: 'toDo' },
		{ id: 's-doing', label: 'In progress', position: 2, category: 'inProgress' },
		{ id: 's-done', label: 'Done', position: 3, category: 'done' },
		{ id: 's-nope', label: "Won't do", position: 4, category: 'canceled' }
	]
};

export function registry(fields: FieldDef[] = [], extra: Partial<FieldRegistry> = {}): FieldRegistry {
	const natives: FieldDef[] = [
		STATUS,
		{ key: 'native:assignees', name: 'Assignees', kind: 'people', ordered: false, editable: true, appliesTo: [] },
		{
			key: 'native:labels',
			name: 'Labels',
			kind: 'multiSelect',
			ordered: false,
			editable: true,
			appliesTo: [],
			scopedExclusive: true,
			options: [
				{ id: 'l-bug', label: 'bug', position: 0 },
				{ id: 'l-be', label: 'area::backend', position: 1 },
				{ id: 'l-fe', label: 'area::frontend', position: 2 }
			]
		},
		{ key: 'native:weight', name: 'Weight', kind: 'number', ordered: true, editable: true, appliesTo: [] },
		{ key: 'native:dueDate', name: 'Due date', kind: 'date', ordered: true, editable: true, appliesTo: [] },
		{ key: 'native:startDate', name: 'Start date', kind: 'date', ordered: true, editable: true, appliesTo: [] },
		{ key: 'native:milestone', name: 'Milestone', kind: 'singleSelect', ordered: false, editable: true, appliesTo: [], options: [{ id: 'm1', label: 'Q4', position: 0 }] },
		{ key: 'native:project', name: 'Project', kind: 'ref', ordered: false, editable: false, appliesTo: [], options: [{ id: 'g/api', label: 'API', position: 0 }, { id: 'g/web', label: 'Web', position: 1 }] },
		{ key: 'native:parent', name: 'Parent', kind: 'ref', ordered: false, editable: true, appliesTo: [], options: [{ id: 'e1', label: 'Epic one', position: 0 }] },
		{ key: 'native:type', name: 'Type', kind: 'singleSelect', ordered: false, editable: false, appliesTo: [], options: [{ id: 'Issue', label: 'Issue', position: 0 }, { id: 'Task', label: 'Task', position: 1 }, { id: 'Epic', label: 'Epic', position: 2 }] },
		{ key: 'native:updatedAt', name: 'Updated', kind: 'date', ordered: true, editable: false, appliesTo: [] }
	];
	return {
		fields: [...natives, ...fields],
		people: [
			{ id: 'u1', name: 'Alex', username: 'alex' },
			{ id: 'u2', name: 'Sam', username: 'sam' }
		],
		projects: [
			{ id: 'g/api', name: 'API', fullPath: 'g/api', url: null },
			{ id: 'g/web', name: 'Web', fullPath: 'g/web', url: null }
		],
		types: [
			{ id: 't1', name: 'Issue' },
			{ id: 't5', name: 'Task' },
			{ id: 't8', name: 'Epic' }
		],
		currentUserId: 'u1',
		warnings: [],
		...extra
	};
}

let n = 0;
export function item(values: Partial<Record<string, FieldValue>> = {}, extra: Partial<WorkItem> = {}): WorkItem {
	n++;
	const type = extra.type ?? 'Issue';
	return {
		id: `gid://gitlab/WorkItem/${n}`,
		iid: n,
		ref: `g/api#${n}`,
		type: 'Issue',
		title: `Item ${n}`,
		url: null,
		description: '',
		descriptionTruncated: false,
		state: 'open',
		closedAt: null,
		createdAt: '2026-10-01T00:00:00Z',
		updatedAt: '2026-11-01T00:00:00Z',
		projectId: 'g/api',
		parentId: null,
		progress: null,
		canDelete: false,
		...extra,
		values: { 'native:type': { kind: 'option', id: type }, ...values } as WorkItem['values']
	};
}

export const opt = (id: string): FieldValue => ({ kind: 'option', id });
export const num = (value: number): FieldValue => ({ kind: 'number', value });
export const date = (value: string): FieldValue => ({ kind: 'date', value });
export const people = (...ids: string[]): FieldValue => ({ kind: 'people', ids });
export const many = (...ids: string[]): FieldValue => ({ kind: 'options', ids });
