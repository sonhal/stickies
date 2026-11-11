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
 * Writes: the browser never sends GraphQL. The server only ever sends the two mutations in this
 * file, with variables built from input validated against the FieldRegistry (src/lib/server/write/).
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
	groupWorkItemTypes: true
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
}

export function parseCapabilities(raw: unknown): Capabilities {
	const r = (raw ?? {}) as CapsRaw;
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
		groupWorkItemTypes: has(r.group?.fields, 'workItemTypes')
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
      parent { id title state }
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
// VERIFY(phase0): group.iterations needs Premium; on Free the capability probe should leave it out
export function schemaQuery(c: Capabilities): string {
	return /* GraphQL */ `
query BoardSchema($fullPath: ID!) {
  currentUser { id username name }
  group(fullPath: $fullPath) {
    id
    fullPath
    name
    ${
			c.groupCustomFields
				? `customFields(active: true) {
      nodes { id name fieldType active selectOptions { id value } workItemTypes { id name } }
    }`
				: ''
		}
    ${
			c.groupWorkItemTypes
				? `workItemTypes {
      nodes {
        id
        name
        ${c.status ? `widgetDefinitions { type ... on WorkItemWidgetDefinitionStatus { allowedStatuses { ${statusFields(c)} } } }` : ''}
      }
    }`
				: ''
		}
    projects(includeSubgroups: true, first: 100) {
      nodes { id name fullPath webUrl archived }
    }
    labels(includeAncestorGroups: true, includeDescendantGroups: true, first: 100) {
      nodes { id title color }
    }
    milestones(includeAncestors: true, includeDescendants: true, state: active, first: 100) {
      nodes { id title dueDate }
    }
    ${c.iterations ? 'iterations(includeAncestors: true, state: opened, first: 50) { nodes { id title startDate dueDate iterationCadence { id title } } }' : ''}
    groupMembers(relations: [DIRECT, INHERITED, DESCENDANTS], first: 100) {
      nodes { user { id username name } }
    }
  }
}`;
}

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
