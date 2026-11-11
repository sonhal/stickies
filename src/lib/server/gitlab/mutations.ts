/**
 * GitLab mutation input shapes for the write path. Like queries.ts and normalize.ts, this is
 * GitLab-shape-specific: if your instance names a widget input differently, fix it here.
 * validate.ts decides WHAT may be written; this file only says how GitLab spells it.
 */

/** VERIFY(phase0): custom field global id format, used as customFieldId in customFieldsWidget. */
export function customFieldGid(key: string): string {
	return `gid://gitlab/Issuables::CustomField/${key.slice('custom:'.length)}`;
}

type Input = Record<string, unknown>;

/** VERIFY(phase0): every widget input name below (WorkItemUpdateInput / WorkItemCreateInput on 18.x). */
export const widgetInput = {
	/** VERIFY(phase0): statusWidget { status: <WorkItems::Statuses::*::Status gid> } */
	status: (id: string | null): Input => ({ statusWidget: { status: id } }),
	assignees: (ids: string[]): Input => ({ assigneesWidget: { assigneeIds: ids } }),
	labelsUpdate: (add: string[], remove: string[]): Input => ({ labelsWidget: { addLabelIds: add, removeLabelIds: remove } }),
	/** VERIFY(phase0): on create, labelsWidget takes labelIds */
	labelsCreate: (ids: string[]): Input => ({ labelsWidget: { labelIds: ids } }),
	weight: (w: number | null): Input => ({ weightWidget: { weight: w } }),
	/** VERIFY(phase0): setting one date leaves the other unchanged when only that key is sent; isFixed: true */
	date: (which: 'startDate' | 'dueDate', v: string | null): Input => ({ startAndDueDateWidget: { [which]: v, isFixed: true } }),
	milestone: (id: string | null): Input => ({ milestoneWidget: { milestoneId: id } }),
	iteration: (id: string | null): Input => ({ iterationWidget: { iterationId: id } }),
	/** VERIFY(phase0): hierarchyWidget { parentId: null } removes the parent */
	parent: (id: string | null): Input => ({ hierarchyWidget: { parentId: id } }),
	/** VERIFY(phase0): customFieldsWidget is a list of { customFieldId, selectedOptionIds | numberValue | textValue | dateValue } */
	custom: (key: string, part: Input): Input => ({ customFieldsWidget: [{ customFieldId: customFieldGid(key), ...part }] }),
	customSelect: (ids: string[]) => ({ selectedOptionIds: ids }),
	customNumber: (n: number | null) => ({ numberValue: n }),
	customText: (t: string | null) => ({ textValue: t }),
	customDate: (d: string | null) => ({ dateValue: d }),
	update: (id: string, widgets: Input): Input => ({ id, ...widgets }),
	title: (id: string, title: string): Input => ({ id, title }),
	/** VERIFY(phase0): workItemCreate takes namespacePath (project full path) + workItemTypeId */
	create: (namespacePath: string, workItemTypeId: string, title: string, description?: string): Input => ({
		namespacePath,
		workItemTypeId,
		title,
		...(description ? { description } : {})
	})
};

/** Combine widget inputs for one create: custom field entries are a list, dates merge. */
export function mergeWidgets(input: Input, widgets: Input): void {
	for (const [k, v] of Object.entries(widgets)) {
		if (k === 'customFieldsWidget') input[k] = [...((input[k] as unknown[]) ?? []), ...(v as unknown[])];
		else if (k === 'startAndDueDateWidget') input[k] = { ...((input[k] as object) ?? {}), ...(v as object) };
		else input[k] = v;
	}
}

/** GitLab mutation errors → a short message for the toast. Shown as text, never HTML. */
export function friendlyMutationError(errors: string[]): string {
	const all = errors.join(' ');
	if (/permission|not allowed|not authorized|does not exist or you don't have/i.test(all)) {
		return "You don't have permission to change this in GitLab.";
	}
	return `GitLab rejected the change: ${all.slice(0, 200)}`;
}
