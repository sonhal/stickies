/**
 * Every GraphQL document the board sends to GitLab. Together with normalize.ts this is the ONLY
 * place that knows GitLab's GraphQL shapes. If `scripts/introspect.ts` shows a different shape on
 * your instance, fix it here and in normalize.ts. Nothing else should need to change.
 *
 * Target: GitLab 18.x Work Items API. Shapes marked `VERIFY(phase0)` are best knowledge and need
 * checking against a real instance (see README → "Things to verify against your GitLab").
 *
 * GraphQL rejects a whole query if it names a type the server doesn't have. So the optional
 * parts (statuses, custom fields, date custom fields, rolled-up counts, iterations) are only
 * included when the CAPABILITIES probe found them. An older GitLab gets a smaller board, not an error.
 *
 * Writes: the browser never sends GraphQL. The server only ever sends the three mutations in this
 * file (update, create, delete), with variables built from input validated against the
 * FieldRegistry and the viewer's own items (src/lib/server/write/).
 */

/** Which optional schema parts exist on this GitLab. Not viewer-specific. */
export interface Capabilities {
	status: boolean;
	statusCategory: boolean;
	customFields: boolean;
	selectValue: boolean;
	numberValue: boolean;
	textValue: boolean;
	dateValue: boolean;
	rolledUpCounts: boolean;
	iterations: boolean;
	groupCustomFields: boolean;
	groupWorkItemTypes: boolean;
	/** WorkItemWidgetDefinitionHierarchy.allowedChildTypes: which types each type may hold as children */
	hierarchyTypes: boolean;
}

export const ALL_CAPABILITIES: Capabilities = {
	status: true,
	statusCategory: true,
	customFields: true,
	selectValue: true,
	numberValue: true,
	textValue: true,
	dateValue: true,
	rolledUpCounts: true,
	iterations: true,
	groupCustomFields: true,
	groupWorkItemTypes: true,
	hierarchyTypes: true
};

/** Introspection probe. `__type` returns null for a type that doesn't exist. */
export const CAPABILITIES = /* GraphQL */ `
query BoardCapabilities {
  status: __type(name: "WorkItemWidgetStatus") { name }
  statusType: __type(name: "WorkItemStatus") { fields { name } }
  customFields: __type(name: "WorkItemWidgetCustomFields") { name }
  selectValue: __type(name: "WorkItemSelectFieldValue") { name }
  numberValue: __type(name: "WorkItemNumberFieldValue") { name }
  textValue: __type(name: "WorkItemTextFieldValue") { name }
  dateValue: __type(name: "WorkItemDateFieldValue") { name }
  hierarchy: __type(name: "WorkItemWidgetHierarchy") { fields { name } }
  iteration: __type(name: "WorkItemWidgetIteration") { name }
  group: __type(name: "Group") { fields { name } }
  hierarchyDef: __type(name: "WorkItemWidgetDefinitionHierarchy") { fields { name } }
}`;

interface CapsRaw {
	status?: { name: string } | null;
	statusType?: { fields?: { name: string }[] | null } | null;
	customFields?: { name: string } | null;
	selectValue?: { name: string } | null;
	numberValue?: { name: string } | null;
	textValue?: { name: string } | null;
	dateValue?: { name: string } | null;
	hierarchy?: { fields?: { name: string }[] | null } | null;
	iteration?: { name: string } | null;
	group?: { fields?: { name: string }[] | null } | null;
	hierarchyDef?: { fields?: { name: string }[] | null } | null;
}

/**
 * GitLab caches introspection: a query with `__type`/`__schema` and no `operationName` can be
 * answered with the whole cached `__schema` instead of the aliases asked for (seen on gitlab.com).
 * Turn that reply into the shape the probe asked for, so both answers read the same.
 */
function fromFullSchema(raw: unknown): CapsRaw | null {
	const types = (raw as { __schema?: { types?: unknown } } | null)?.__schema?.types;
	if (!Array.isArray(types)) return null;
	const byName = new Map<string, { name: string; fields?: { name: string }[] | null }>();
	for (const t of types) if (t && typeof t.name === 'string') byName.set(t.name, t);
	const type = (n: string) => byName.get(n) ?? null;
	return {
		status: type('WorkItemWidgetStatus'),
		statusType: type('WorkItemStatus'),
		customFields: type('WorkItemWidgetCustomFields'),
		selectValue: type('WorkItemSelectFieldValue'),
		numberValue: type('WorkItemNumberFieldValue'),
		textValue: type('WorkItemTextFieldValue'),
		dateValue: type('WorkItemDateFieldValue'),
		hierarchy: type('WorkItemWidgetHierarchy'),
		iteration: type('WorkItemWidgetIteration'),
		group: type('Group'),
		hierarchyDef: type('WorkItemWidgetDefinitionHierarchy')
	};
}

export function parseCapabilities(raw: unknown): Capabilities {
	const r = fromFullSchema(raw) ?? ((raw ?? {}) as CapsRaw);
	const has = (list: { name: string }[] | null | undefined, n: string) => !!list?.some((f) => f.name === n);
	return {
		status: !!r.status,
		statusCategory: has(r.statusType?.fields, 'category'),
		customFields: !!r.customFields,
		selectValue: !!r.selectValue,
		numberValue: !!r.numberValue,
		textValue: !!r.textValue,
		dateValue: !!r.dateValue,
		rolledUpCounts: has(r.hierarchy?.fields, 'rolledUpCountsByType'),
		iterations: !!r.iteration,
		groupCustomFields: has(r.group?.fields, 'customFields'),
		groupWorkItemTypes: has(r.group?.fields, 'workItemTypes'),
		hierarchyTypes: has(r.hierarchyDef?.fields, 'allowedChildTypes')
	};
}

const statusFields = (c: Capabilities) => (c.statusCategory ? 'id name color category' : 'id name color');

/**
 * Widgets read for every work item. Also returned by the mutations, so a write can refresh the cache.
 *
 * VERIFY(phase0): for project issues `namespace` is the project (fullPath = project path); for epics it is the group.
 * VERIFY(phase0): WorkItemWidgetHierarchy.rolledUpCountsByType { workItemType { name } countsByState { all closed } }
 * VERIFY(phase0): WorkItemWidgetStatus.status { id name color category }, category enum TRIAGE/TO_DO/IN_PROGRESS/DONE/CANCELED
 * VERIFY(phase0): WorkItemWidgetCustomFields.customFieldValues is a list of an interface with
 *   customField { id name fieldType } and per-type parts: WorkItemSelectFieldValue.selectedOptions { id value },
 *   WorkItemNumberFieldValue.value, WorkItemTextFieldValue.value
 */
export function workItemFragment(c: Capabilities): string {
	const customValueParts = [
		c.selectValue && '... on WorkItemSelectFieldValue { selectedOptions { id value } }',
		// Aliased on purpose: `value` is Float / String / Date on these types, and GraphQL rejects one
		// response key with different types even across mutually exclusive fragments (FieldsInSetCanMerge).
		c.numberValue && '... on WorkItemNumberFieldValue { numberValue: value }',
		c.textValue && '... on WorkItemTextFieldValue { textValue: value }',
		// VERIFY(phase0): date custom fields (WorkItemDateFieldValue.value) exist on your version
		c.dateValue && '... on WorkItemDateFieldValue { dateValue: value }'
	].filter(Boolean);
	return /* GraphQL */ `
fragment BoardWorkItem on WorkItem {
  id
  iid
  title
  state
  createdAt
  updatedAt
  closedAt
  webUrl
  reference(full: true)
  userPermissions { deleteWorkItem }
  workItemType { id name }
  namespace { id fullPath name }
  widgets {
    type
    ... on WorkItemWidgetDescription { description }
    ... on WorkItemWidgetAssignees { assignees { nodes { id username name } } }
    ... on WorkItemWidgetLabels { labels { nodes { id title color } } }
    ... on WorkItemWidgetMilestone { milestone { id title dueDate } }
    ${c.iterations ? '... on WorkItemWidgetIteration { iteration { id title startDate dueDate iterationCadence { id title } } }' : ''}
    ... on WorkItemWidgetWeight { weight }
    ... on WorkItemWidgetStartAndDueDate { startDate dueDate }
    ... on WorkItemWidgetHierarchy {
      parent { id title state workItemType { name } }
      ${c.rolledUpCounts ? 'rolledUpCountsByType { workItemType { name } countsByState { all closed } }' : ''}
    }
    ${c.status ? `... on WorkItemWidgetStatus { status { ${statusFields(c)} } }` : ''}
    ${
			c.customFields
				? `... on WorkItemWidgetCustomFields {
      customFieldValues {
        customField { id name fieldType }
        ${customValueParts.join('\n        ')}
      }
    }`
				: ''
		}
  }
}`;
}

/**
 * All open items (and, with state: closed, recently closed ones) of the group and its projects.
 * Closed items are fetched newest-updated first; the loader stops paging once items are older
 * than CLOSED_DAYS_MAX, so this does not depend on a closedAfter argument existing.
 * VERIFY(phase0): group.workItems(includeDescendants: true) returns project-level issues.
 * VERIFY(phase0): type enum values EPIC / ISSUE / TASK, and sort value UPDATED_DESC.
 */
export function groupWorkItemsQuery(c: Capabilities): string {
	return /* GraphQL */ `
query BoardGroupWorkItems($fullPath: ID!, $state: IssuableState!, $after: String, $first: Int!) {
  group(fullPath: $fullPath) {
    workItems(includeDescendants: true, state: $state, types: [EPIC, ISSUE, TASK], sort: UPDATED_DESC, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ...BoardWorkItem }
    }
  }
}
${workItemFragment(c)}`;
}

/** Fallback (GITLAB_ITEMS_MODE=projects) when group workItems does not include project issues. */
export function projectWorkItemsQuery(c: Capabilities): string {
	return /* GraphQL */ `
query BoardProjectWorkItems($fullPath: ID!, $state: IssuableState!, $after: String, $first: Int!) {
  project(fullPath: $fullPath) {
    workItems(state: $state, types: [ISSUE, TASK], sort: UPDATED_DESC, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ...BoardWorkItem }
    }
  }
}
${workItemFragment(c)}`;
}

/**
 * Everything that describes the fields: custom field definitions, allowed statuses per type,
 * projects, labels, milestones, iterations, members, and the current user.
 * Split from the items query to keep query complexity low; cached ~10 min per viewer.
 */
// VERIFY(phase0): group.customFields(active: true) { nodes { id name fieldType active selectOptions { id value } workItemTypes { id name } } }
//   with selectOptions in the order set in GitLab
// VERIFY(phase0): group.workItemTypes, and WorkItemWidgetDefinitionStatus.allowedStatuses on its widgetDefinitions
// WorkItemWidgetDefinitionHierarchy.allowedChildTypes (a connection of WorkItemType) per the GraphQL reference:
//   GitLab's hierarchy is Epic → Epic | Issue, Issue → Task, Objective → Objective | Key result, and
//   types are configurable, so the board reads it rather than assuming it.
// VERIFY(phase0): group.iterations needs Premium; on Free the capability probe should leave it out
/**
 * The group's lists the board needs for its field registry. Each is fetched page by page (review M7):
 * the schema query asks for the first page of all of them, then `schemaPageQuery` follows the
 * cursor of any list that has more, up to SCHEMA_LIST_MAX entries.
 * VERIFY(phase0): customFields takes first/after and returns pageInfo like the other connections.
 */
export const SCHEMA_LIST_PAGE = 100;
export const SCHEMA_LIST_MAX = 2000;

export interface SchemaList {
	/** Connection field on Group, also the key in RawSchema.group */
	name: 'customFields' | 'projects' | 'labels' | 'milestones' | 'iterations' | 'groupMembers';
	/** What the user sees in a "list was cut" warning */
	label: string;
	args: string;
	nodes: string;
	enabled: (c: Capabilities) => boolean;
}

export const SCHEMA_LISTS: SchemaList[] = [
	{
		name: 'customFields',
		label: 'custom fields',
		args: 'active: true',
		nodes: 'id name fieldType active selectOptions { id value } workItemTypes { id name }',
		enabled: (c) => c.groupCustomFields
	},
	{ name: 'projects', label: 'projects', args: 'includeSubgroups: true', nodes: 'id name fullPath webUrl archived', enabled: () => true },
	{
		name: 'labels',
		label: 'labels',
		args: 'includeAncestorGroups: true, includeDescendantGroups: true',
		nodes: 'id title color',
		enabled: () => true
	},
	{
		name: 'milestones',
		label: 'milestones',
		args: 'includeAncestors: true, includeDescendants: true, state: active',
		nodes: 'id title dueDate',
		enabled: () => true
	},
	{
		name: 'iterations',
		label: 'iterations',
		args: 'includeAncestors: true, state: opened',
		nodes: 'id title startDate dueDate iterationCadence { id title }',
		enabled: (c) => c.iterations
	},
	{
		name: 'groupMembers',
		label: 'group members',
		args: 'relations: [DIRECT, INHERITED, DESCENDANTS]',
		nodes: 'user { id username name }',
		enabled: () => true
	}
];

const listField = (l: SchemaList, after: boolean) =>
	`${l.name}(${l.args}, first: ${SCHEMA_LIST_PAGE}${after ? ', after: $after' : ''}) {
      pageInfo { hasNextPage endCursor }
      nodes { ${l.nodes} }
    }`;

/** Per-type definitions the board reads: allowed statuses, and allowed child types. */
function widgetDefinitions(c: Capabilities): string {
	const parts = [
		c.status ? `... on WorkItemWidgetDefinitionStatus { allowedStatuses { ${statusFields(c)} } }` : '',
		c.hierarchyTypes ? '... on WorkItemWidgetDefinitionHierarchy { allowedChildTypes { nodes { id name } } }' : ''
	].filter(Boolean);
	return parts.length ? `widgetDefinitions { type ${parts.join(' ')} }` : '';
}

export function schemaQuery(c: Capabilities): string {
	return /* GraphQL */ `
query BoardSchema($fullPath: ID!) {
  currentUser { id username name }
  group(fullPath: $fullPath) {
    id
    fullPath
    name
    ${
			c.groupWorkItemTypes
				? `workItemTypes {
      nodes {
        id
        name
        ${widgetDefinitions(c)}
      }
    }`
				: ''
		}
    ${SCHEMA_LISTS.filter((l) => l.enabled(c))
			.map((l) => listField(l, false))
			.join('\n    ')}
  }
}`;
}

/** The next page of one schema list. */
export function schemaPageQuery(list: SchemaList): string {
	return /* GraphQL */ `
query BoardSchemaPage($fullPath: ID!, $after: String!) {
  group(fullPath: $fullPath) {
    ${listField(list, true)}
  }
}`;
}

/**
 * One item's full Markdown description, for the editor. The board itself only keeps a shortened
 * plain-text copy, which can't be edited without losing formatting.
 */
export const DESCRIPTION_QUERY = /* GraphQL */ `
query BoardDescription($id: WorkItemID!) {
  workItem(id: $id) {
    id
    widgets {
      type
      ... on WorkItemWidgetDescription { description }
    }
  }
}`;

// ---- Mutations (the write allowlist) ---------------------------------------------------------

/**
 * VERIFY(phase0): workItemUpdate widget input names:
 *   statusWidget { status }, customFieldsWidget [{ customFieldId, selectedOptionIds | numberValue | textValue | dateValue }],
 *   assigneesWidget { assigneeIds }, labelsWidget { addLabelIds removeLabelIds },
 *   hierarchyWidget { parentId } (null removes), milestoneWidget { milestoneId },
 *   iterationWidget { iterationId }, weightWidget { weight },
 *   startAndDueDateWidget { startDate dueDate isFixed }
 */
export function updateWorkItemMutation(c: Capabilities): string {
	return /* GraphQL */ `
mutation BoardUpdateWorkItem($input: WorkItemUpdateInput!) {
  workItemUpdate(input: $input) {
    errors
    workItem { ...BoardWorkItem }
  }
}
${workItemFragment(c)}`;
}

/** VERIFY(phase0): workItemCreate takes namespacePath + workItemTypeId + widget inputs on 18.x */
export function createWorkItemMutation(c: Capabilities): string {
	return /* GraphQL */ `
mutation BoardCreateWorkItem($input: WorkItemCreateInput!) {
  workItemCreate(input: $input) {
    errors
    workItem { ...BoardWorkItem }
  }
}
${workItemFragment(c)}`;
}

/**
 * Deletes one work item (any type, epics too). The only input is the item's global id, which the
 * server takes from the viewer's own board, never from the browser as-is (src/lib/server/write/delete.ts).
 * The payload has no work item to return: success is "no errors". Marked deprecated in the schema
 * like workItemUpdate (an "experiment" since 15.1), but it is what GitLab's own UI uses.
 */
export const deleteWorkItemMutation = /* GraphQL */ `
mutation BoardDeleteWorkItem($input: WorkItemDeleteInput!) {
  workItemDelete(input: $input) {
    errors
  }
}`;
