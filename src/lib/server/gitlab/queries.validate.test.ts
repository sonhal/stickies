/**
 * Runs the board's work item query through the real GraphQL validator, against a small schema that
 * copies the shape of GitLab's types for the parts the query uses.
 *
 * The fake GitLab used by the other tests never validates queries, so a query GitLab would reject
 * (e.g. review H2: one response key with conflicting types) passed every test. This catches that
 * class of bug: field-merge conflicts, fragments on the wrong type, misspelled fields.
 *
 * The SDL is a hand-written subset, not GitLab's real schema. When scripts/introspect.ts has been
 * run against your instance, compare it with the introspected types and fix any difference here
 * and in queries.ts together.
 */
import { describe, expect, it } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { ALL_CAPABILITIES, workItemFragment } from './queries';

const SDL = /* GraphQL */ `
	scalar Time
	scalar Date
	scalar WorkItemsCustomFieldID

	enum IssuableState { opened closed all locked }
	enum WorkItemState { OPEN CLOSED }
	enum WorkItemWidgetType { DESCRIPTION ASSIGNEES LABELS MILESTONE ITERATION WEIGHT START_AND_DUE_DATE HIERARCHY STATUS CUSTOM_FIELDS }
	enum WorkItemStatusCategoryEnum { TRIAGE TO_DO IN_PROGRESS DONE CANCELED }
	enum CustomFieldType { SINGLE_SELECT MULTI_SELECT NUMBER TEXT DATE }

	type Query { workItem(id: ID!): WorkItem }

	type WorkItemType { id: ID! name: String! }
	type Namespace { id: ID! fullPath: ID! name: String! }
	type UserCore { id: ID! username: String! name: String! }
	type UserCoreConnection { nodes: [UserCore] }
	type Label { id: ID! title: String! color: String! }
	type LabelConnection { nodes: [Label] }
	type Milestone { id: ID! title: String! dueDate: Time }
	type IterationCadence { id: ID! title: String! }
	type Iteration { id: ID! title: String startDate: Time dueDate: Time iterationCadence: IterationCadence! }

	type WorkItem {
		id: ID!
		iid: String!
		title: String!
		state: WorkItemState!
		createdAt: Time!
		updatedAt: Time!
		closedAt: Time
		webUrl: String
		reference(full: Boolean = false): String!
		workItemType: WorkItemType!
		namespace: Namespace
		widgets: [WorkItemWidget!]
	}

	interface WorkItemWidget { type: WorkItemWidgetType }
	type WorkItemWidgetDescription implements WorkItemWidget { type: WorkItemWidgetType description: String }
	type WorkItemWidgetAssignees implements WorkItemWidget { type: WorkItemWidgetType assignees: UserCoreConnection }
	type WorkItemWidgetLabels implements WorkItemWidget { type: WorkItemWidgetType labels: LabelConnection }
	type WorkItemWidgetMilestone implements WorkItemWidget { type: WorkItemWidgetType milestone: Milestone }
	type WorkItemWidgetIteration implements WorkItemWidget { type: WorkItemWidgetType iteration: Iteration }
	type WorkItemWidgetWeight implements WorkItemWidget { type: WorkItemWidgetType weight: Int }
	type WorkItemWidgetStartAndDueDate implements WorkItemWidget { type: WorkItemWidgetType startDate: Date dueDate: Date }

	type WorkItemTypeCountsByState { all: Int! closed: Int! }
	type WorkItemTypeCounts { workItemType: WorkItemType! countsByState: WorkItemTypeCountsByState! }
	type WorkItemWidgetHierarchy implements WorkItemWidget {
		type: WorkItemWidgetType
		parent: WorkItem
		rolledUpCountsByType: [WorkItemTypeCounts!]
	}

	type WorkItemStatus { id: ID name: String color: String category: WorkItemStatusCategoryEnum }
	type WorkItemWidgetStatus implements WorkItemWidget { type: WorkItemWidgetType status: WorkItemStatus }

	type CustomField { id: WorkItemsCustomFieldID! name: String! fieldType: CustomFieldType! }
	type CustomFieldSelectOption { id: ID! value: String! }
	interface WorkItemCustomFieldValue { customField: CustomField! }
	type WorkItemSelectFieldValue implements WorkItemCustomFieldValue { customField: CustomField! selectedOptions: [CustomFieldSelectOption!] }
	type WorkItemNumberFieldValue implements WorkItemCustomFieldValue { customField: CustomField! value: Float }
	type WorkItemTextFieldValue implements WorkItemCustomFieldValue { customField: CustomField! value: String }
	type WorkItemDateFieldValue implements WorkItemCustomFieldValue { customField: CustomField! value: Date }
	type WorkItemWidgetCustomFields implements WorkItemWidget { type: WorkItemWidgetType customFieldValues: [WorkItemCustomFieldValue!] }
`;

const schema = buildSchema(SDL);
const errorsFor = (fragment: string) =>
	validate(schema, parse(`query Q($id: ID!) { workItem(id: $id) { ...BoardWorkItem } }\n${fragment}`)).map((e) => e.message);

describe('work item fragment against a GitLab-shaped schema', () => {
	it('is valid with every capability on', () => {
		expect(errorsFor(workItemFragment(ALL_CAPABILITIES))).toEqual([]);
	});

	it('is valid with optional capabilities off', () => {
		const off = Object.fromEntries(Object.keys(ALL_CAPABILITIES).map((k) => [k, false])) as unknown as typeof ALL_CAPABILITIES;
		expect(errorsFor(workItemFragment(off))).toEqual([]);
	});

	it('the validator rejects the old unaliased custom field values (review H2)', () => {
		// Proves this test would have caught H2: same key `value`, types Float / String / Date.
		const broken = workItemFragment(ALL_CAPABILITIES)
			.replace('numberValue: value', 'value')
			.replace('textValue: value', 'value')
			.replace('dateValue: value', 'value');
		expect(errorsFor(broken).join('\n')).toMatch(/"value" conflict because they return conflicting types/);
	});
});
