/**
 * The board's own data model. Nothing in here knows GitLab's GraphQL shapes: the server adapter
 * (src/lib/server/gitlab/normalize.ts) turns GitLab responses into these types.
 *
 * Rule D2: no code may depend on a specific custom field name or option value. Custom fields are
 * described at runtime by a FieldRegistry, items store option *ids*, and labels/order come from
 * the registry.
 */

export const NATIVE_FIELDS = [
	'status',
	'assignees',
	'labels',
	'weight',
	'dueDate',
	'startDate',
	'milestone',
	'iteration',
	'project',
	'parent',
	'epic',
	'type',
	'createdAt',
	'updatedAt'
] as const;
export type NativeField = (typeof NATIVE_FIELDS)[number];

/** `custom:<numeric GitLab CustomField id>` stays stable when the field is renamed. */
export type FieldKey = `native:${NativeField}` | `custom:${string}`;

export type FieldKind =
	| 'singleSelect'
	| 'multiSelect'
	| 'number'
	| 'text'
	| 'date'
	| 'people'
	| 'ref'
	| 'status';

/** Built-in work item status categories. Board columns and "done" logic use these, never names. */
export const STATUS_CATEGORIES = ['triage', 'toDo', 'inProgress', 'done', 'canceled'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface OptionDef {
	id: string;
	label: string;
	/** 0-based position in GitLab's own order. That order IS the ranking (see rankDirection). */
	position: number;
	category?: StatusCategory;
	/** A CSS color from GitLab (labels, statuses). Only ever a validated #hex value. */
	color?: string;
	/** Extra text, e.g. a milestone's due date or a project's path */
	hint?: string;
}

export interface FieldDef {
	key: FieldKey;
	/** Display name, straight from GitLab */
	name: string;
	kind: FieldKind;
	/** In GitLab's order. */
	options?: OptionDef[];
	/** single-select, number, date and status: usable for sort and as a matrix axis */
	ordered: boolean;
	/** Whether the board offers editing this field (the server re-checks on every write) */
	editable: boolean;
	/** Work item type names the field is enabled for. Empty = all types. */
	appliesTo: string[];
	/** For custom fields of a type the board does not know: GitLab's raw type name. Shown read-only. */
	rawType?: string;
	/** labels: options with a `scope::` prefix are exclusive within their scope */
	scopedExclusive?: boolean;
}

export type FieldValue =
	| { kind: 'option'; id: string }
	| { kind: 'options'; ids: string[] }
	| { kind: 'number'; value: number }
	| { kind: 'text'; value: string }
	| { kind: 'date'; value: string }
	| { kind: 'people'; ids: string[] }
	| { kind: 'ref'; id: string };

export interface WorkItem {
	/** GitLab global id, e.g. gid://gitlab/WorkItem/123 */
	id: string;
	iid: number;
	/** Full reference, e.g. "my-team/api#123" */
	ref: string;
	/** Work item type name, e.g. "Issue". Just data: no type-specific code paths. */
	type: string;
	title: string;
	/** Only ever an http(s) URL, or null */
	url: string | null;
	/** Plain text (Markdown stripped on the server), truncated. Rendered as text, never HTML. */
	description: string;
	descriptionTruncated: boolean;
	state: 'open' | 'closed';
	closedAt: string | null;
	createdAt: string;
	updatedAt: string;
	projectId: string | null;
	parentId: string | null;
	/** Rolled-up child counts from GitLab (epic progress), when available */
	progress: { total: number; closed: number } | null;
	/** EVERY field, custom or native, lives here */
	values: Partial<Record<FieldKey, FieldValue>>;
	/**
	 * GitLab says this viewer may delete the item (normally only project Owners). Only a hint for
	 * the UI, false when unknown: the server still lets GitLab decide on every delete.
	 */
	canDelete: boolean;
}

export interface Person {
	id: string;
	name: string;
	username: string;
}

export interface ProjectRef {
	id: string;
	name: string;
	fullPath: string;
	url: string | null;
}

export interface WorkItemTypeDef {
	id: string;
	name: string;
}

/** Everything the browser needs to interpret item values. Built per viewer. */
export interface FieldRegistry {
	fields: FieldDef[];
	people: Person[];
	projects: ProjectRef[];
	types: WorkItemTypeDef[];
	/** Global id of the signed-in user (null for the kiosk) */
	currentUserId: string | null;
	/** Non-fatal schema problems, e.g. "custom fields are not available on this GitLab" */
	warnings: string[];
}

export type LoadProblem =
	| { kind: 'config'; message: string }
	/** The signed-in user's token was rejected: they need to sign in again */
	| { kind: 'auth'; message: string }
	| { kind: 'gitlab'; status: number; message: string };

export interface BoardData {
	items: WorkItem[];
	registry: FieldRegistry;
	/** ISO timestamp of when the items were fetched from GitLab */
	fetchedAt: string | null;
	/** True when GitLab failed and we are showing the last good response */
	stale: boolean;
	problem: LoadProblem | null;
	groupLabel: string;
	/** Closed items older than this many days are not fetched */
	closedDaysMax: number;
}

export const isCustomKey = (k: string): k is `custom:${string}` => k.startsWith('custom:');
export const isNativeKey = (k: string): k is `native:${NativeField}` =>
	k.startsWith('native:') && (NATIVE_FIELDS as readonly string[]).includes(k.slice(7));
