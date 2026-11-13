import { describe, expect, it } from 'vitest';
import caps from './fixtures/capabilities.json';
import schema from './fixtures/schema.json';
import open from './fixtures/workItems.open.json';
import closed from './fixtures/workItems.closed.json';
import {
	customFieldKind,
	emptySeen,
	gidTail,
	mergeSeen,
	normalizeSchema,
	normalizeWorkItem,
	safeColor,
	statusCategory,
	type RawSchema,
	type RawWorkItem
} from './normalize';
import { parseCapabilities, workItemFragment, schemaQuery, ALL_CAPABILITIES } from './queries';

const reg = normalizeSchema(schema as RawSchema, { iterations: true });
const projectPaths = new Set(reg.projects.map((p) => p.fullPath));
const seen = emptySeen();
const rawItems = [...open.group.workItems.nodes, ...closed.group.workItems.nodes] as unknown as RawWorkItem[];
const items = rawItems.map((r) => normalizeWorkItem(r, { projectPaths, seen }));
const byId = Object.fromEntries(items.map((i) => [i.id, i]));
const merged = mergeSeen(reg, seen, items);
const field = (key: string) => merged.fields.find((f) => f.key === key)!;

describe('capabilities', () => {
	it('parses the probe', () => {
		const c = parseCapabilities(caps);
		expect(c.status && c.statusCategory && c.customFields && c.rolledUpCounts && c.groupCustomFields).toBe(true);
		expect(c.dateValue).toBe(false);
	});
	it("reads GitLab's cached full __schema reply the same way as the aliased probe", () => {
		// gitlab.com answers a `__type` query sent without operationName with the whole schema.
		const t = (name: string, fields: string[] = []) => ({ kind: 'OBJECT', name, fields: fields.map((f) => ({ name: f })) });
		const c = parseCapabilities({
			__schema: {
				queryType: { name: 'Query' },
				types: [
					t('WorkItemWidgetStatus'),
					t('WorkItemStatus', ['id', 'name', 'category']),
					t('WorkItemWidgetCustomFields'),
					t('WorkItemSelectFieldValue'),
					t('WorkItemNumberFieldValue'),
					t('WorkItemTextFieldValue'),
					t('WorkItemWidgetHierarchy', ['parent', 'rolledUpCountsByType']),
					t('WorkItemWidgetIteration'),
					t('Group', ['id', 'customFields', 'workItemTypes']),
					t('WorkItemWidgetDefinitionHierarchy', ['allowedChildTypes', 'allowedParentTypes']),
					{ kind: 'SCALAR', name: 'Date', fields: null },
					null
				]
			}
		});
		expect(c).toEqual({ ...ALL_CAPABILITIES, dateValue: false });
		expect(parseCapabilities({ __schema: { types: [] } }).status).toBe(false);
	});
	it('leaves out fragments for missing types', () => {
		const c = parseCapabilities(caps);
		expect(workItemFragment(c)).not.toContain('WorkItemDateFieldValue');
		expect(workItemFragment(ALL_CAPABILITIES)).toContain('WorkItemDateFieldValue');
		const old = parseCapabilities({});
		const frag = workItemFragment(old);
		expect(frag).not.toContain('WorkItemWidgetStatus');
		expect(frag).not.toContain('customFieldValues');
		expect(schemaQuery(old)).not.toContain('customFields');
		expect(schemaQuery(old)).not.toContain('allowedChildTypes');
		expect(schemaQuery(ALL_CAPABILITIES)).toContain('allowedChildTypes');
	});
});

describe('normalizeSchema', () => {
	it('builds custom fields from definitions, keyed by numeric id, options in GitLab order', () => {
		const prio = reg.fields.find((f) => f.name === 'Priority')!;
		expect(prio.key).toBe('custom:7');
		expect(prio.kind).toBe('singleSelect');
		expect(prio.ordered).toBe(true);
		expect(prio.options!.map((o) => o.label)).toEqual(['Critical', 'High', 'Medium', 'Low']);
		expect(prio.options!.map((o) => o.position)).toEqual([0, 1, 2, 3]);
		expect(prio.appliesTo).toEqual(['Issue', 'Task']);
	});

	it("reads each type's allowed child types (GitLab's hierarchy)", () => {
		const byName = Object.fromEntries(reg.types.map((t) => [t.name, t.childTypes]));
		expect(byName).toEqual({ Issue: ['Task'], Task: [], Epic: ['Epic', 'Issue'] });
	});

	it('keeps unknown custom field types as read-only text', () => {
		const f = reg.fields.find((x) => x.name === 'Confidence')!;
		expect(f.kind).toBe('text');
		expect(f.editable).toBe(false);
		expect(f.rawType).toBe('RATING');
	});

	it('orders statuses by category and dedupes across types', () => {
		const s = reg.fields.find((f) => f.key === 'native:status')!;
		expect(s.options!.map((o) => o.label)).toEqual([
			'Needs triage',
			'To do',
			'In progress',
			'Blocked',
			'Done',
			"Won't do",
			'Duplicate'
		]);
		expect(s.options![0].category).toBe('triage');
		expect(s.appliesTo).toEqual(['Issue', 'Task']);
	});

	it('drops archived projects, unsafe colors, and knows the current user', () => {
		expect(reg.projects.map((p) => p.name)).toEqual(['API', 'Web']);
		const labels = reg.fields.find((f) => f.key === 'native:labels')!;
		expect(labels.options!.find((o) => o.label === 'customer')!.color).toBeUndefined();
		expect(reg.currentUserId).toBe('gid://gitlab/User/101');
	});

	it('survives an empty response', () => {
		const r = normalizeSchema({}, { iterations: false });
		expect(r.warnings.length).toBe(1);
		expect(r.fields.some((f) => f.key === 'native:iteration')).toBe(false);
	});
});

describe('normalizeWorkItem', () => {
	it('reads every widget into values', () => {
		const i = byId['gid://gitlab/WorkItem/1001'];
		expect(i.iid).toBe(12);
		expect(i.type).toBe('Issue');
		expect(i.state).toBe('open');
		expect(i.projectId).toBe('acme/platform/api');
		expect(i.parentId).toBe('gid://gitlab/WorkItem/900');
		expect(i.values['native:status']).toEqual({ kind: 'option', id: 'gid://gitlab/WorkItems::Statuses::SystemDefined::Status/2' });
		expect(i.values['native:weight']).toEqual({ kind: 'number', value: 3 });
		expect(i.values['native:dueDate']).toEqual({ kind: 'date', value: '2026-11-20' });
		expect(i.values['native:startDate']).toBeUndefined();
		expect(i.values['native:labels']).toEqual({ kind: 'options', ids: ['gid://gitlab/GroupLabel/301', 'gid://gitlab/GroupLabel/302'] });
		expect(i.values['native:assignees']).toEqual({ kind: 'people', ids: ['gid://gitlab/User/102'] });
		expect(i.values['custom:7']).toEqual({ kind: 'option', id: 'gid://gitlab/Issuables::CustomFieldSelectOption/71' });
		expect(i.values['custom:8']).toBeUndefined(); // no option selected
		expect(i.values['custom:9']).toEqual({
			kind: 'options',
			ids: ['gid://gitlab/Issuables::CustomFieldSelectOption/91', 'gid://gitlab/Issuables::CustomFieldSelectOption/93']
		});
		expect(i.values['custom:10']).toEqual({ kind: 'number', value: 5 });
		expect(i.values['custom:11']).toEqual({ kind: 'text', value: '<b>Big Co</b>' }); // rendered as text by the UI
		expect(i.values['custom:12']).toBeUndefined();
	});

	it('turns the description into plain text', () => {
		const i = byId['gid://gitlab/WorkItem/1001'];
		expect(i.description).toBe('Problem\nCustomers in the EU get a 500.\nalert(1)');
	});

	it('reads epics: group namespace, rolled-up progress', () => {
		const e = byId['gid://gitlab/WorkItem/900'];
		expect(e.type).toBe('Epic');
		expect(e.projectId).toBeNull();
		expect(e.progress).toEqual({ total: 10, closed: 6 });
	});

	it('reads the delete permission, and treats a missing one as "no"', () => {
		expect(byId['gid://gitlab/WorkItem/1001'].canDelete).toBe(true);
		expect(byId['gid://gitlab/WorkItem/900'].canDelete).toBe(false);
		expect(byId['gid://gitlab/WorkItem/1002'].canDelete).toBe(false); // no userPermissions in the response
		const base = rawItems[0];
		const odd = (userPermissions: unknown) => normalizeWorkItem({ ...base, userPermissions } as RawWorkItem, { projectPaths }).canDelete;
		expect(odd(null)).toBe(false);
		expect(odd({})).toBe(false);
		expect(odd({ deleteWorkItem: 'true' })).toBe(false);
		expect(odd({ deleteWorkItem: true })).toBe(true);
	});

	it('blocks javascript: urls and reads closed items', () => {
		expect(byId['gid://gitlab/WorkItem/1002'].url).toBeNull();
		const c = byId['gid://gitlab/WorkItem/1003'];
		expect(c.state).toBe('closed');
		expect(c.closedAt).toBe('2026-11-07T10:00:00Z');
	});
});

describe('mergeSeen', () => {
	it('adds statuses and inactive custom fields seen only on items', () => {
		const s = field('native:status');
		const extra = s.options!.find((o) => o.label === 'Waiting on vendor')!;
		expect(extra.category).toBe('inProgress');
		// category order is kept: the new status sits with the other in-progress ones
		const labels = s.options!.map((o) => o.label);
		expect(labels.indexOf('Waiting on vendor')).toBeLessThan(labels.indexOf('Done'));
		const old = field('custom:77');
		expect(old.name).toBe('Old field');
		expect(old.editable).toBe(false);
		expect(old.options!.map((o) => o.label)).toEqual(['Yes']);
	});

	it('lists epics and parents as parent options', () => {
		expect(field('native:parent').options!.map((o) => o.label).sort()).toEqual([
			'Checkout fails for EU customers',
			'Payments v2'
		]);
	});

	it('gives parents the board did not load an option with their title (review H1)', () => {
		const s2 = emptySeen();
		const parentOf = (id: string, title: string | null, state: string) =>
			({
				id: `gid://gitlab/WorkItem/${id}-child-${Math.random()}`,
				iid: 1,
				title: 'child',
				state: 'OPEN',
				createdAt: '2026-11-01T00:00:00Z',
				updatedAt: '2026-11-01T00:00:00Z',
				widgets: [{ type: 'HIERARCHY', parent: { id: `gid://gitlab/WorkItem/${id}`, title, state } }]
			}) as unknown as RawWorkItem;
		const kids = [parentOf('999', 'Old closed epic', 'CLOSED'), parentOf('999', 'Old closed epic', 'CLOSED'), parentOf('998', null, 'OPEN')].map(
			(r) => normalizeWorkItem(r, { projectPaths, seen: s2 })
		);
		const opts = mergeSeen(reg, s2, kids).fields.find((f) => f.key === 'native:parent')!.options!;
		expect(opts.map((o) => [o.id, o.label])).toEqual([
			['gid://gitlab/WorkItem/999', 'Old closed epic (closed)'],
			['gid://gitlab/WorkItem/998', 'Parent not on the board']
		]);
		expect(opts.map((o) => o.position)).toEqual([0, 1]);
	});

	it('lists loaded epics and unloaded parents that GitLab says are epics as Epic options', () => {
		const s3 = emptySeen();
		const child = (parent: Record<string, unknown>) =>
			normalizeWorkItem(
				{
					id: `gid://gitlab/WorkItem/c-${Math.random()}`,
					iid: 1,
					title: 'child',
					state: 'OPEN',
					createdAt: '2026-11-01T00:00:00Z',
					updatedAt: '2026-11-01T00:00:00Z',
					widgets: [{ type: 'HIERARCHY', parent }]
				} as unknown as RawWorkItem,
				{ projectPaths, seen: s3 }
			);
		const kids = [
			child({ id: 'gid://gitlab/WorkItem/999', title: 'Old closed epic', state: 'CLOSED', workItemType: { name: 'Epic' } }),
			child({ id: 'gid://gitlab/WorkItem/997', title: 'Some issue', state: 'OPEN', workItemType: { name: 'Issue' } })
		];
		const opts = mergeSeen(reg, s3, kids).fields.find((f) => f.key === 'native:epic')!.options!;
		expect(opts.map((o) => o.label)).toEqual(['Old closed epic (closed)']);
	});

	it('does not change the input registry', () => {
		expect(reg.fields.find((f) => f.key === 'native:parent')!.options).toEqual([]);
	});
});

describe('helpers', () => {
	it('maps category spellings', () => {
		expect(statusCategory('TO_DO')).toBe('toDo');
		expect(statusCategory('in_progress')).toBe('inProgress');
		expect(statusCategory('CANCELLED')).toBe('canceled');
		expect(statusCategory('weird')).toBeUndefined();
	});
	it('maps field types and ids', () => {
		expect(customFieldKind('single_select')).toBe('singleSelect');
		expect(customFieldKind('RATING')).toBeNull();
		expect(gidTail('gid://gitlab/Issuables::CustomField/7')).toBe('7');
		expect(safeColor('#fff')).toBe('#fff');
		expect(safeColor('red;background:url(x)')).toBeUndefined();
	});
});
