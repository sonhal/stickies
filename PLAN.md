# Plan: Linear-style views on top of GitLab

Status: **implemented (phases 0–6)** on 2026-11-10. Phase 0 shipped as `scripts/introspect.ts` plus GraphQL
shapes from best knowledge of GitLab 18.x, marked `VERIFY(phase0)` and listed in the README under "Things to verify
against your GitLab", because there was no access to the real instance. Phase 7 (bulk edit, timeline, iterations as
cycles, webhooks, Redis) is not done. §10 records the answers to the open questions and the implementation notes
(deviations).

### Decisions so far

| # | Decision |
|---|---|
| D1 | The board is **editable**: status, custom fields, assignee and other fields can be changed from the board, and issues can be created. |
| D2 | **Custom fields are unknown at build time.** You use single-select custom fields (Priority, Effort, …), but the set of fields and their options can change at any time. No code path may depend on a specific field name or option value. |
| D3 | Status = **GitLab built-in work item status**. `status::` labels are no longer used. |
| D4 | Views = **default views in a config file in the repo** plus **user views in the browser's localStorage**. No server database. |
| D5 | GitLab is a very recent version. Phase 0 reads the exact version from the API and checks the GraphQL shapes. |
| D6 | **Scale: about 100–200 open items.** The board fetches everything and filters in the browser. No server-side filtering is needed. |
| D7 | Completed and canceled items are handled **like Linear**: a per-view display option chooses how many recently completed items to show (§3.1). |
| D8 | **Epics have no child epics**, so the hierarchy is epic → issue (→ task, if tasks exist). |
| D9 | **Team = project.** |
| D10 | The kiosk can show **any config view**, not just the matrix, e.g. "Open issues by epic". |
| D11 | **All common fields are editable** in the first version: status, custom fields, assignees, parent epic, title, weight, start/due date, labels, milestone, iteration, plus create. |

---

## 1. Where the project is today

| Area | Current state | Problem for Linear-style views |
|---|---|---|
| Data source | REST `GET /groups/:id/issues` (`src/lib/server/gitlab.ts`) | REST doesn't return **custom fields**, **built-in statuses**, or the full **epic hierarchy** (only one level, the `epic` field). |
| Domain model | `BoardIssue` with fixed fields (`weight`, `labels`, `dueDate`, `epic`, `assignees`) | There's no field list, so every field is hard-coded. No project, no parent chain. |
| Config | `AxisSource` = `weight \| labels \| dueDate`, label values listed in config | It's tied to exact label values, which breaks D2. |
| UI | One page: Board (matrix) and List (grouped by quadrant) | No grouping or ordering choice, no filter builder, no views, no navigation. |
| Auth | OAuth with `read_api` only. The token scope check rejects anything broader. | D1 needs the `api` scope (§3.6). |
| State | Stateless server, in-memory per-viewer cache | This is still fine. D4 needs no server storage. |

**What's worth keeping:** the security model (per-viewer cache, sealed cookies, CSP, `safeUrl`, plain-text
descriptions), stable epic color slots, the pure and unit-tested logic modules, and the standup walk-through.
The Eisenhower matrix becomes one **layout** among several.

---

## 2. Target: Linear concepts mapped to GitLab

| Linear | GitLab | Notes |
|---|---|---|
| Workspace | Top-level group | `GITLAB_GROUP` |
| Team | Project (initiative or team) | The sidebar lists projects that contain open work. |
| Project | **Epic** | Epic page: progress (closed / total children), child epics, issues. |
| Sub-issue / parent | Work item hierarchy: epic → issue (→ task) | There are no child epics (D8), so epic progress is a simple roll-up. Freestanding issues go in a "No epic" group. |
| Workflow states | **Built-in work item status** | Each status has a *category* (triage / to do / in progress / done / canceled). Board columns and "done" logic use the category, so renamed or added statuses still work. |
| Priority, Estimate, … | **Whatever single-select custom fields exist** | Discovered at runtime (§3.2). |
| Labels | Labels | A multi-value field. |
| Cycles | Iterations or milestones | Optional, later. |
| Views | Config file + localStorage | §3.5 |
| My Issues / Triage | Built-in views | Triage = items missing a value for any field marked "required" in the config, or in the triage status category. |

**Layouts.** Each one renders the same filtered, grouped data:

1. **List**: grouped rows, optional sub-groups, collapsible groups, chosen fields shown as chips, sub-issues nested or flat.
2. **Board (kanban)**: columns = any single-select field (status by default), optional swimlanes. Dragging a card sets the field (D1).
3. **Matrix**: the Eisenhower board, with both axes taken from any **ordered** field (§3.3).
4. *(Later)* **Timeline** for epics.

**Shared "Display options":** filter · group by · sub-group by · order by · visible properties · sub-issues
(nested / flat / hidden) · show empty groups · include closed items from the last N days.

---

## 3. Architecture

```
            ┌──────────────────────────── server (per viewer, using their own token) ────────────────────────────┐
GitLab ─GraphQL─▶ fetch/workItems.ts ─▶ normalize.ts ─▶ WorkItem[] ──────────┐
                  fetch/schema.ts    ─▶ FieldRegistry (custom fields, statuses, projects, labels)
                                                                           ├─▶ per-viewer cache ─▶ +page.server.ts
GitLab ◀─GraphQL mutations── actions/updateWorkItem.ts ◀── validated against FieldRegistry ◀── form action / POST
            └─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                                         ▼ JSON
browser:  ViewDefinition (config file │ localStorage │ URL) ─▶ resolve field refs against FieldRegistry
          ─▶ query engine (pure): filter ─▶ group ─▶ sort ─▶  List │ Board │ Matrix  ─▶ edits (optimistic) ─▶ server
```

### 3.1 Data layer: GraphQL Work Items API

- **Items query** (paginated): `group(fullPath) { workItems(includeDescendants: true, types: [EPIC, ISSUE, TASK], state: opened) }`
  with these widgets: `hierarchy { parent { id } }`, `status`, `customFields`, `assignees`, `labels`, `milestone`,
  `iteration`, `weight`, `startAndDueDate`, `description` (converted to plain text on the server, as today).
- **Completed and canceled items, like Linear (D7).** Each view has a display option
  **Completed issues: All / Past day / Past week / Past month / None**. The default is *Past week* for list and board
  views and *None* for the matrix. A second query fetches items closed in the last 30 days (`CLOSED_DAYS_MAX`, configurable)
  and each view filters within that window. "All" means "everything within that window".
  - An item counts as **completed** if its status category is *done*, and **canceled** if its status category is *canceled*.
    Canceled items follow the same display option, as in Linear.
  - Completed items are drawn muted and sorted to the bottom of their group. On a board they appear in the
    done-category column(s).
- **Epic progress** uses GitLab's rolled-up child counts from the hierarchy widget, so it counts *all* of the epic's issues,
  including ones closed long ago that the board didn't fetch. This becomes a plain count of the epic's direct children
  if the rolled-up counts aren't available on your version.
- **Schema query** (cached about 10 minutes, per viewer):
  - the group's custom field definitions: `id, name, fieldType, active, selectOptions (ordered), workItemTypes`
  - the allowed statuses per work item type, with their category
  - projects, labels, and the current user
- Page size about 50–100, the MAX_PAGES cap stays, and the query is split in two if GitLab's complexity limits require it.

> ⚠️ The GraphQL shapes for custom fields, statuses and work-item epics changed during GitLab 17.x–18.x.
> **Phase 0** checks them against *your* instance. All shape-specific code stays inside `normalize.ts`.

### 3.2 Fields: a runtime registry, no hard-coded names or values (D2)

```ts
// src/lib/fields/types.ts
type FieldKey =
  | `native:${'status' | 'assignees' | 'labels' | 'weight' | 'dueDate' | 'startDate' | 'milestone' | 'iteration' | 'project' | 'parent' | 'type' | 'createdAt' | 'updatedAt'}`
  | `custom:${string}`;            // custom:<numeric GitLab CustomField id>, stable when the field is renamed

interface FieldDef {
  key: FieldKey;
  name: string;                    // display name, straight from GitLab
  kind: 'singleSelect' | 'multiSelect' | 'number' | 'text' | 'date' | 'people' | 'ref' | 'status';
  options?: OptionDef[];           // in GitLab's own order. That order IS the ranking.
  ordered: boolean;                // single-select, number, date and status → usable for sort / matrix axis
  editable: boolean;               // whether the board offers editing this field
  appliesTo: string[];             // work item types the field is enabled for (from GitLab)
}
interface OptionDef { id: string; label: string; position: number; category?: StatusCategory; color?: string }

interface WorkItem {
  id: string; iid: number; ref: string; type: string; title: string; url: string | null;
  description: string; descriptionTruncated: boolean;
  state: 'open' | 'closed'; closedAt: string | null; createdAt: string; updatedAt: string;
  projectId: string | null; parentId: string | null;
  values: Partial<Record<FieldKey, FieldValue>>;  // EVERY field, custom or native, lives here
}
type FieldValue =
  | { kind: 'option'; id: string }                 // single-select / status. The label comes from the registry, not stored per item.
  | { kind: 'options'; ids: string[] }             // multi-select, labels
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'people'; ids: string[] }
  | { kind: 'ref'; id: string };
```

What this means in practice:

- **A new custom field** created in GitLab shows up after the next schema refresh in Filter, Group by, Order by,
  Display properties, Board columns, Matrix axes and the detail panel. No code change or deploy is needed.
- **A new, renamed, reordered or removed option** works the same way. Items store the option *id*. Labels and order come from
  the registry, so a rename shows up everywhere at once.
- **Ordering is the option order you set in GitLab.** The matrix and sorting treat the first option as lowest, or
  highest if the config sets `rankDirection` for the field (or the view). No option values appear in code or config.
- **Fields are referenced by id inside views**, and the reference also stores the name as a fallback:
  `{ field: 'custom:7', name: 'Priority' }`. Resolution tries the id, then a case-insensitive name match.
  The name fallback lets a repo config written as `{ name: 'Priority' }` work across GitLab instances.
- **A view that references a field or option that no longer exists** still loads. The broken rule shows as a
  struck-through filter chip saying "field removed" and is ignored. The view never errors or goes blank.
- Unknown custom field *types* (e.g. GitLab adds a new type) get a generic read-only "text" display, so they are
  still visible, not dropped.
- The board never shows HTML from any field. Everything is rendered as text.

### 3.3 Matrix axes without knowing the values

Today: `scoped('priority', { low: 1, …, critical: 4 })` with `threshold: 2.5`. That hard-codes the options.

New version:

```ts
x: { field: { name: 'Effort' },   split: 'half' },                    // split by option position
y: { field: { name: 'Priority' }, split: { atOption: 'High' } }       // optional explicit split
```

- An item's axis value = the option's **normalized position** (0…1) in GitLab's order (after `rankDirection`).
  The matrix doesn't care how many options exist.
- `split: 'half'` (default) puts the top half of the options in "high". With an odd number of options, the middle one goes
  to "high" (configurable).
- `split: { atOption: 'High' }` is optional. If that option disappears, the matrix falls back to `'half'` and shows a
  warning banner.
- Number and date fields work as today (threshold / horizon days).
- Items with no value land in **Needs triage**, as they do now.
- The existing standup behavior (ordering inside quadrants, the walk-through, epic colors) is unchanged.

### 3.4 Query engine (pure, unit-tested, `src/lib/query/`)

```ts
interface ViewDefinition {
  version: 1;
  id: string; name: string; icon?: string;
  scope?: { projects?: FieldRef[]; epics?: string[] };   // team pages / epic pages
  filter: FilterGroup;
  layout: 'list' | 'board' | 'matrix';
  groupBy?: FieldRef; subGroupBy?: FieldRef;
  orderBy: { field: FieldRef | 'manual'; dir: 'asc' | 'desc' }[];
  display: { properties: FieldRef[]; subIssues: 'nested' | 'flat' | 'hidden'; showEmptyGroups: boolean; closedDays: number };
  matrix?: { x: AxisConfig; y: AxisConfig };
}
type FieldRef = { field?: FieldKey; name?: string };          // id and/or name, see §3.2
type FilterGroup = { op: 'and' | 'or'; rules: (FilterRule | FilterGroup)[] };
type FilterRule = { field: FieldRef; cmp: 'is' | 'isNot' | 'anyOf' | 'noneOf' | 'empty' | 'notEmpty' | 'gt' | 'lt' | 'before' | 'after' | 'contains';
                    value?: unknown };   // for options: option ids, plus labels as a fallback
```

- Filters are a declarative tree. There's no `eval` and no user regex, and the tree is validated with a schema (valibot)
  every time it's loaded from the config, localStorage or the URL.
- Special values: `me` (the current user), `today ± N days`, and `statusCategory: done`.
- An item with several values (labels, assignees, multi-select fields) appears in **each** matching group, like Linear.
- Everything runs in the browser over the viewer's own data, so changing a view is instant.

### 3.5 Views: config file + localStorage (D4)

**Default views** live in `src/lib/views.config.ts`. They are typed and checked at build time, so a broken view fails CI:

```ts
export const defaultViews = defineViews([
  { id: 'standup',   name: 'Standup',      layout: 'matrix', matrix: { x: { field: { name: 'Effort' } }, y: { field: { name: 'Priority' } } }, … },
  { id: 'my-issues', name: 'My issues',    layout: 'list',  filter: and(rule('native:assignees', 'anyOf', ['me'])), groupBy: { field: 'native:status' }, … },
  { id: 'board',     name: 'Active board', layout: 'board', groupBy: { field: 'native:status' }, … },
  { id: 'by-prio',   name: 'By priority',  layout: 'list',  groupBy: { name: 'Priority' }, … },
  { id: 'epics',     name: 'Open issues by epic', layout: 'list', groupBy: { field: 'native:parent' }, subGroupBy: { field: 'native:status' }, … },
  { id: 'team-board', name: 'Team boards', layout: 'board', groupBy: { field: 'native:status' }, subGroupBy: { field: 'native:project' }, … },
]);
```

**User views** are stored in `localStorage`:
- The key is `board.views.v1.<gitlabUserId>`, so two people sharing a computer don't see each other's views.
  The kiosk uses config views only.
- Each user view stores **only the view definition**, never issue data. localStorage can be read by any script on the
  origin, so the strict CSP that blocks third-party scripts stays in place.
- Every read and write is wrapped in try/catch. If storage is blocked or full (private window), the board still
  works with config views and shows a small "views can't be saved in this browser" note.
- Views are validated on load. A corrupt entry is skipped and logged, and the rest still load. A `version` field allows
  migrations.
- Actions:
  - **Save as new view**, **Duplicate** (a config view into a personal copy), **Rename**, **Delete**, **Reorder**
    (the sidebar order is stored in localStorage too).
  - **Share link**: the URL holds the view as compressed JSON (`?v=…`), and the recipient can "Save to my views".
  - **Export / import JSON**, to move views to another browser or to propose one for the repo config.
- localStorage is per browser and per device: views don't follow a person from their laptop to their phone.
  That's an accepted limitation of D4. Export/import covers it.

### 3.6 Writes (D1)

**What can be edited**
- **Status**: board drag, panel, keyboard `s`.
- **Any single-select custom field**: board drag when it's the group-by field, panel, command palette.
  Other custom field types (number, text, multi-select) are editable from the panel.
- **Assignees**: panel, keyboard `a`.
- **Parent epic**: panel, or drag between epic groups in the "by epic" view. You can also remove the parent.
- **Title**: panel.
- **Weight**: panel, keyboard `w`.
- **Start and due date**: panel, with a date picker and quick choices ("today", "+1 week").
- **Labels**: panel, keyboard `l`. GitLab enforces that only one label per `scope::` can be set, and the picker shows that.
- **Milestone and iteration**: panel. Options come from the project's and its group's milestones and from the group's iteration cadences.
- **Create issue**: `c`. The project, parent epic, status and fields are pre-filled from the current view's filters and
  group, like Linear.

**How writes are made**
- SvelteKit form actions / POST endpoints. These are covered by SvelteKit's origin check (CSRF).
- The server holds a **fixed allowlist of GraphQL mutations** (`workItemUpdate` with specific widgets only,
  `workItemCreate`). The browser never sends GraphQL. It sends `{ itemId, field, value }`. The server resolves the field
  in the FieldRegistry and checks, for example, that the option id belongs to that field, that the field applies to that work
  item type, and that a title is within length limits. Only then does it build the mutation.
- GitLab still enforces permissions with the user's own token. A Guest who can't edit gets GitLab's error,
  shown as "You don't have permission to change this", and the card snaps back.
- **Optimistic UI**: the change shows at once and is rolled back with a toast if GitLab rejects it. On success,
  the viewer's cache entry is updated in place (no full refetch), and other viewers see it on their next refresh.
- **Conflicts**: last write wins, the same as GitLab's own UI. The panel shows "updated by someone else"
  when the refetched `updatedAt` is newer than when the panel was opened.
- **Rate limiting**: a per-session cap (e.g. 60 writes/minute) to protect against a runaway client.

**Token scope (Q1 = Option A).** Editing is always possible: there is a single sign-in tier that requests
**`api`**. GitLab has no write scope limited to issues, so `api` allows everything the user can do in GitLab, through
the API. The risks and what the board does about them:

| Risk | Mitigation |
|---|---|
| A stolen session cookie gives a powerful token | It's AES-256-GCM sealed, HttpOnly, Secure and SameSite=Lax. Every session carries an `api` token, so `SESSION_MAX_AGE_DAYS` now defaults to **1 day**. Tokens are revoked on sign-out, as today. |
| A bug in the board is used to call arbitrary GitLab APIs | No generic proxy. Only allowlisted mutations, built on the server from validated input. |
| XSS in the board would act as the user | Strict CSP stays (no inline scripts, no third-party scripts), all GitLab content is rendered as text, and no `{@html}` is used. |
| A misconfigured GitLab application | The token scope check accepts **exactly `api`** for user sign-in (broader or narrower is refused). |
| Kiosk | **Always read-only**: its service token (`GITLAB_TOKEN`) must be exactly `read_api` (checked via `/personal_access_tokens/self`), and write endpoints refuse kiosk sessions. |

### 3.7 UI shell and routes

```
/                      → first view (config order, then user views)
/v/:viewId             config or local view (resolved in the browser for local ids)
/team/:projectPath     project-scoped version of the current view
/epics                 epic list: progress bar, child counts, dates
/epics/:id             epic page: description, progress, children (list/board)
/kiosk/[key]           unchanged sign-in. The screen shows config views only (D10):
                         KIOSK_VIEWS=standup,epics      one or more config view ids
                         KIOSK_ROTATE_SECONDS=60        optional: cycle through them (0 = stay on the first)
                       A kiosk can also switch between config views from the sidebar. It can never edit, and it has no
                       personal views.
```

- **Sidebar:** views (config, then personal), teams (projects), epics.
- **Top bar:** filter chips with an "add filter" menu built from the FieldRegistry, plus a Display popover.
- **Detail panel:** extends `IssueDetails`. Every field is editable inline, with parent breadcrumbs and child items.
- **Command palette** (`⌘/Ctrl K`): jump to a view, team, epic or issue, and run actions (set status, set field, assign, create).
- **Keyboard:** `j/k` move, `Enter` open, `Esc` close, `c` create, `s` status, `a` assign, `x` select,
  bulk edits on the selection, `g` + key to go to a view.

### 3.8 Performance and caching

- Per-viewer item cache (30 s, as today) and a separate schema cache (about 10 min). Writes update the cache in place.
- At 100–200 open items plus at most a month of closed ones (D6), the whole dataset is a few hundred KB of JSON. The
  board fetches it in a handful of GraphQL pages and filters everything in the browser. No server-side filtering or
  virtualized lists are needed. The MAX_PAGES cap stays as a safety net.
- Multi-replica: the README note still applies (Redis or sticky sessions). Write rate limits would also move to Redis.
- Optional later: GitLab webhooks to invalidate caches for near-real-time updates.

---

## 4. Phases

Each phase ends in a working, tested board.

| Phase | Content |
|---|---|
| **0. Spike** (½–1 day) | `scripts/introspect.ts` with a read-only token. It reports the GitLab version, whether group `workItems(includeDescendants)` returns project issues, the shapes of custom fields and status widgets, the allowed statuses per type, mutation input shapes for status and custom fields, and the epic depth. Outputs scrubbed fixtures for tests. |
| **1. Data + FieldRegistry** | GraphQL fetch, normalizer, registry, schema cache. The matrix moves to field-based axes (§3.3) and keeps today's look. The `status::` label config is removed in favor of the built-in status. |
| **2. Query engine + List** | `src/lib/query/*`, list layout, filter bar, Display popover, URL view state, read-only detail panel showing all fields. |
| **3. Views** | `views.config.ts`, localStorage store, save/duplicate/rename/delete/reorder, share link, export/import, sidebar, command palette (navigation only). |
| **4. Writes** | `api` scope, mutation allowlist, validation, optimistic updates, inline edits in the panel, keyboard actions, create issue, write rate limit. |
| **5. Board (kanban)** | Columns by any single-select field or status. Drag to update. |
| **6. Epics** | Epic list and epic pages, progress from rolled-up counts, "Open issues by epic" view. This is small because there are no child epics. |
| **7. Optional** | Bulk edit, timeline, iterations as cycles, webhooks, Redis. |

Writes (4) come before Board (5) so that drag-and-drop works from the start.

---

## 5. Testing

- Vitest unit tests on the pure modules: field resolution (renamed field, removed option, reordered options,
  unknown type), the matrix split with 2, 3, 4 and 7 options, filter/group/sort, and view validation and migration.
- Normalizer snapshot tests on the Phase 0 fixtures, with personal data scrubbed.
- Write path tests: invalid option id, field not applicable to the type, kiosk session, missing CSRF origin, rate limit.
- Fuzz tests that throw random JSON at the view parser (URL and localStorage) to make sure the page never crashes.
- Playwright smoke tests against a fake GitLab GraphQL server: list, board drag, matrix, palette, saving a view and
  reloading the page.

## 6. Security checklist carried forward

Per-viewer caches (items and schema) · no tokens in the browser · text-only rendering · `safeUrl` on links ·
strict CSP with all libraries bundled · validated view definitions from every source · mutation allowlist ·
read-only kiosk · write rate limit · shorter sessions with write scope.

## 7. Dependencies likely added

`valibot` (schema validation) · `lz-string` (view in the URL) · a small bundled drag-and-drop helper (or native
HTML5 DnD with keyboard fallbacks). No server database and no UI framework.

## 8. Migration of the current config

`board.config.ts` → `views.config.ts` (the "standup" view). Axis `labels`/`weight`/`dueDate` sources are converted
automatically where possible. The `status` block is removed (built-in status is used). `epicColors` stays.

## 9. Risks

| Risk | Mitigation |
|---|---|
| GraphQL shapes differ by GitLab version | Phase 0 spike, with all shape-specific code in `normalize.ts` |
| Complexity limits or timeouts on large groups | Smaller pages, split queries, the page cap, pushing scope into GraphQL args |
| GitLab option order doesn't match "low → high" | A `rankDirection` setting per field or per view |
| The `api` scope is broad | §3.6 mitigations |
| localStorage views don't follow users across devices | Share links and export/import. A server store can be added later without changing the view format. |

---

## 10. Open questions: answers

1. **Editing for everyone, or opt-in?** → **Option A.** Everyone signs in with `api`; there is no "Enable editing"
   button and no read/write tier. `SESSION_MAX_AGE_DAYS` defaults to 1. The kiosk stays read-only (`read_api`).
2. **gitlab.com or self-managed?** → Unknown; a very recent GitLab (18.x). `GITLAB_URL` stays configurable.
3. **Option order** → Assumed **high → low** (`defaultRankDirection: 'firstHighest'`), configurable per field
   (`settings.fieldSettings`), per view (`rankDirection`) and per matrix axis.
4. **Tasks** → May exist. Handled generically (the type is just data); no task-specific UI.

### Implementation notes (deviations)

- **Completed window** is stored as `display.completed: 'all' | 'day' | 'week' | 'month' | 'none'` instead of a
  number of days, matching the Linear options one to one (capped by `CLOSED_DAYS_MAX`).
- **Standup view** keeps today's urgency axis (weight, threshold 3) and takes importance from `{ name: 'Priority' }`
  (split at "High"), as the faithful migration of `board.config.ts`. The §3.5 example (Effort × Priority) ships as a
  separate "Priority × effort" view. The `status::` highlight from the old config is gone; the note shows the built-in
  status with its GitLab color.
- **Capability probe.** The queries are built from a `__type` probe, so optional parts (statuses, custom fields,
  date custom fields, rolled-up counts, iterations) are only requested when the instance has them.
- **Closed items** are fetched sorted by `UPDATED_DESC` and paging stops past `CLOSED_DAYS_MAX`, so no `closedAfter`
  argument is needed.
- **`GITLAB_ITEMS_MODE=projects`** is a fallback if group `workItems(includeDescendants)` doesn't return project issues.
- **Writes** use JSON POST endpoints (`/api/items/update`, `/api/items/create`) with an explicit same-origin check,
  since SvelteKit's built-in check only covers form content types. Mutation input shapes live in
  `src/lib/server/gitlab/mutations.ts` (a third adapter file next to `queries.ts` and `normalize.ts`).
- **Bulk edit and `x` selection** (Phase 7) are not implemented.
- **Kiosk sidebar** lists the `KIOSK_VIEWS` views only, not every config view.
- **Epic URLs** are `/epics/<numeric work item id>`; team pages use `?view=<id>` to pick the view (default: "Team issues").
- **Dependencies:** `valibot`, `lz-string`, and `@types/node` (dev; `npm run check` failed without it). Drag and drop
  uses native HTML5 DnD with an `Alt`+arrow keyboard alternative, so no drag library.
