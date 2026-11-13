<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { keepShellParams } from '$lib/client/urlState';
	import { closedKind, optionById, orderedOptions, personName } from '$lib/fields/registry';
	import {
		ASSIGNEE_ME,
		ASSIGNEE_NONE,
		epicField,
		epicListQuery,
		epicRows,
		epicSlug,
		filterEpicRows,
		groupEpicRows,
		hasEpicFilters,
		isEpic,
		parseEpicListState,
		sortEpicRows,
		toggleEpicSort,
		type EpicGroupKey,
		type EpicListState,
		type EpicSortKey
	} from '$lib/query/epics';
	import { slotVar } from '$lib/colors';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import OptionPicker, { type PickOption } from '$lib/components/ui/OptionPicker.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import StatusIcon from '$lib/components/ui/StatusIcon.svelte';

	const board = getBoard();
	const ui = getUi();

	// The list state is kept here so typing and clicking feel instant, and mirrored to the URL so
	// reload and sharing keep it. Changing the URL re-runs the board load on the server, so the
	// search box only writes it once typing pauses.
	let s = $state<EpicListState>(parseEpicListState(page.url.searchParams, board.reg));
	let writing = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function push() {
		timer = undefined;
		// The open issue and sidebar ride along (from the address bar: they're written there shallowly).
		const qs = keepShellParams(epicListQuery(s), new URLSearchParams(location.search));
		if ((qs ? `?${qs}` : '') === location.search) return;
		writing++;
		goto(page.url.pathname + (qs ? `?${qs}` : ''), { replaceState: true, keepFocus: true, noScroll: true }).finally(() => writing--);
	}

	function set(patch: Partial<EpicListState>, later = false) {
		s = { ...s, ...patch };
		clearTimeout(timer);
		if (later) timer = setTimeout(push, 300);
		else push();
	}

	// The URL changed from outside (back/forward, the sidebar link): follow it. Our own writes are
	// skipped, otherwise a slow navigation could put back text the user has already typed over.
	$effect(() => {
		const params = page.url.searchParams;
		untrack(() => {
			if (writing || timer !== undefined) return;
			const next = parseEpicListState(params, board.reg);
			if (epicListQuery(next) !== epicListQuery(s)) s = next;
		});
	});
	onDestroy(() => clearTimeout(timer));

	const statusField = $derived(epicField(board.reg, 'native:status'));
	const assigneeField = $derived(epicField(board.reg, 'native:assignees'));
	const labelField = $derived(epicField(board.reg, 'native:labels'));

	const all = $derived(epicRows(board.items, board.reg));
	const rows = $derived(sortEpicRows(filterEpicRows(all, s, board.reg), s.sort, s.dir));
	const groups = $derived(groupEpicRows(rows, s.group, board.reg, board.items));
	const filtered = $derived(hasEpicFilters(s));
	const hiddenClosed = $derived(s.closed ? 0 : all.filter((r) => r.closed).length);

	// Columns that would be empty for every epic are left out.
	const showStatus = $derived(!!statusField || all.some((r) => r.status));
	const showAssignees = $derived(!!assigneeField && (all.some((r) => r.assignees.length) || s.group === 'assignee' || s.assignee.length > 0));
	const columns = $derived(
		['minmax(0, 1fr)', showStatus && '150px', showAssignees && '84px', '190px', '110px', '96px', '96px'].filter(Boolean).join(' ')
	);

	const statusOptions = $derived<PickOption[]>(
		statusField ? orderedOptions(statusField).map((o) => ({ id: o.id, label: o.label, color: o.color })) : []
	);
	const assigneeOptions = $derived<PickOption[]>(
		assigneeField
			? [
					...(board.reg.currentUserId ? [{ id: ASSIGNEE_ME, label: 'Me', hint: 'whoever is signed in' }] : []),
					{ id: ASSIGNEE_NONE, label: 'Unassigned' },
					...board.reg.people.map((p) => ({ id: p.id, label: p.name, hint: `@${p.username}` }))
				]
			: []
	);
	// Only labels some epic has (plus the picked ones): a group can have hundreds of labels.
	const labelOptions = $derived.by<PickOption[]>(() => {
		if (!labelField) return [];
		const used = new Set([...all.flatMap((r) => r.labels), ...s.label]);
		return orderedOptions(labelField)
			.filter((o) => used.has(o.id))
			.map((o) => ({ id: o.id, label: o.label, color: o.color }));
	});

	const GROUPS = $derived<[EpicGroupKey, string][]>([
		['none', 'No grouping'],
		...(statusField ? [['status', 'Status'] as [EpicGroupKey, string]] : []),
		...(assigneeField ? [['assignee', 'Assignee'] as [EpicGroupKey, string]] : []),
		['parent', 'Parent epic']
	]);

	const toggled = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	/** Text on a filter button: its name, the one picked value, or how many are picked. */
	function summary(name: string, picked: string[], options: PickOption[]): string {
		if (!picked.length) return name;
		if (picked.length === 1) return `${name}: ${options.find((o) => o.id === picked[0])?.label ?? '1'}`;
		return `${name}: ${picked.length}`;
	}
	const clearFilters = () => set({ q: '', status: [], assignee: [], label: [] });

	const canCreate = $derived(!ui.readOnly && board.reg.types.some((t) => t.name.toLowerCase() === 'epic'));
	const noEpic = $derived(board.items.filter((i) => !isEpic(i) && !i.parentId && !closedKind(board.reg, i)).length);

	// The shell's `/` shortcut asks for the search box.
	let searchInput: HTMLInputElement | undefined = $state();
	let searchSeen = ui.searchRequest;
	$effect(() => {
		if (ui.searchRequest === searchSeen) return;
		searchSeen = ui.searchRequest;
		searchInput?.focus();
	});
</script>

<svelte:head><title>Epics · Board</title></svelte:head>

{#snippet th(key: EpicSortKey, label: string)}
	<span role="columnheader" class="c-{key}" aria-sort={s.sort === key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
		<button type="button" class="sort" class:on={s.sort === key} title="Sort by {label.toLowerCase()}" onclick={() => set(toggleEpicSort(s, key))}>
			{label}
			<svg class="arrow" class:desc={s.dir === 'desc'} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
				><path d="M5 8.5v-7M2 4.2l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg
			>
		</button>
	</span>
{/snippet}

<div class="page">
	<header>
		<h1>Epics <span class="n">{rows.length}</span></h1>
		{#if canCreate}
			<button type="button" class="btn primary" onclick={() => (ui.createOpen = { ...ui.createDefaults, type: 'Epic' })}>
				<span aria-hidden="true">+</span> New epic
			</button>
		{/if}
	</header>

	<div class="bar">
		<label class="search">
			<span class="visually-hidden">Search epics</span>
			<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
				><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" /><path
					d="M11 11l3.5 3.5"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-linecap="round"
				/></svg
			>
			<input
				bind:this={searchInput}
				type="search"
				placeholder="Search epics"
				value={s.q}
				oninput={(e) => set({ q: e.currentTarget.value }, true)}
				onkeydown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
			/>
		</label>

		{#if statusField}
			<Popover label="Filter by status" triggerClass={s.status.length ? 'btn filter on' : 'btn filter'} width="240px">
				{#snippet trigger()}{summary('Status', s.status, statusOptions)}{/snippet}
				{#snippet children()}
					<OptionPicker options={statusOptions} multi selected={s.status} placeholder="Status…" onpick={(id) => set({ status: toggled(s.status, id) })}>
						{#snippet icon(o)}<StatusIcon status={optionById(statusField, o.id)} size={12} />{/snippet}
					</OptionPicker>
				{/snippet}
			</Popover>
		{/if}
		{#if assigneeField}
			<Popover label="Filter by assignee" triggerClass={s.assignee.length ? 'btn filter on' : 'btn filter'} width="260px">
				{#snippet trigger()}{summary('Assignee', s.assignee, assigneeOptions)}{/snippet}
				{#snippet children()}
					<OptionPicker options={assigneeOptions} multi selected={s.assignee} placeholder="Assignee…" onpick={(id) => set({ assignee: toggled(s.assignee, id) })} />
				{/snippet}
			</Popover>
		{/if}
		{#if labelOptions.length}
			<Popover label="Filter by label" triggerClass={s.label.length ? 'btn filter on' : 'btn filter'} width="260px">
				{#snippet trigger()}{summary('Label', s.label, labelOptions)}{/snippet}
				{#snippet children()}
					<OptionPicker options={labelOptions} multi selected={s.label} placeholder="Label…" onpick={(id) => set({ label: toggled(s.label, id) })} />
				{/snippet}
			</Popover>
		{/if}
		{#if filtered}<button type="button" class="btn ghost filter" onclick={clearFilters}>Clear</button>{/if}

		<span class="spacer"></span>
		<label class="toggle"><input type="checkbox" checked={s.closed} onchange={(e) => set({ closed: e.currentTarget.checked })} /> Show recently closed</label>
		<label class="group">
			<span>Group</span>
			<select class="input" value={s.group} onchange={(e) => set({ group: e.currentTarget.value as EpicGroupKey })}>
				{#each GROUPS as [k, label] (k)}<option value={k}>{label}</option>{/each}
			</select>
		</label>
	</div>

	<div class="table" role="table" aria-label="Epics" style="--cols: {columns}">
		<div class="tr th" role="row">
			{@render th('title', 'Epic')}
			{#if showStatus}<span role="columnheader" class="c-status">Status</span>{/if}
			{#if showAssignees}<span role="columnheader" class="c-people">Assignee</span>{/if}
			{@render th('progress', 'Progress')}
			{@render th('open', 'Open on board')}
			{@render th('start', 'Start')}
			{@render th('due', 'Due')}
		</div>
		{#each groups as g (g.key)}
			{#if s.group !== 'none'}
				<div class="gh" role="row">
					<span role="cell">
						{#if s.group === 'status'}<StatusIcon status={g.status ?? null} />{/if}
						{#if s.group === 'assignee' && g.personId}<Avatar id={g.personId} name={g.label} size={18} />{/if}
						<span class="gl">{g.label}</span>
						<span class="gn">{g.rows.length}</span>
					</span>
				</div>
			{/if}
			<!-- An epic with several assignees is in several groups, so the key needs the group too. -->
			{#each g.rows as x (`${g.key}|${x.e.id}`)}
				<a class="tr" role="row" href="/epics/{epicSlug(x.e.id)}" class:closed={!!x.closed}>
					<span class="name" role="cell">
						<span class="dot" style="background: {slotVar(board.colors.slotFor(x.e))}"></span>
						<span class="title">{x.e.title}</span>
						<span class="ref">{x.e.ref}</span>
					</span>
					{#if showStatus}
						<span role="cell" class="c-status status">
							{#if x.status}<StatusIcon status={x.status} /><span class="clip">{x.status.label}</span>{:else}<span class="none">—</span>{/if}
						</span>
					{/if}
					{#if showAssignees}
						<span role="cell" class="c-people people">
							{#each x.assignees.slice(0, 3) as id (id)}<Avatar {id} name={personName(board.reg, id)} />{/each}
							{#if x.assignees.length > 3}<span class="more">+{x.assignees.length - 3}</span>{/if}
							{#if !x.assignees.length}<span class="none">—</span>{/if}
						</span>
					{/if}
					<span role="cell" class="c-progress"><ProgressBar p={x.progress} /></span>
					<span role="cell" class="c-open num">{x.open}</span>
					<span role="cell" class="c-start date">{x.start || '—'}</span>
					<span role="cell" class="c-due date">{x.due || '—'}</span>
				</a>
			{/each}
		{/each}
		{#if !rows.length}
			<div class="empty">
				{#if filtered}
					<p>No epics match.</p>
					<button type="button" class="btn" onclick={clearFilters}>Clear filters</button>
				{:else}
					<p>No epics on this board.</p>
					{#if hiddenClosed}
						<button type="button" class="btn" onclick={() => set({ closed: true })}>Show {hiddenClosed} recently closed</button>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
	<p class="muted foot">
		{noEpic} open item{noEpic === 1 ? ' has' : 's have'} no epic. See <a href="/v/epics">Open issues by epic</a>.
		Progress uses GitLab's rolled-up counts (all child items) when available.
	</p>
</div>

<style>
	.page {
		padding: 12px 20px 32px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 30px;
		margin-bottom: 8px;
	}
	h1 {
		margin: 0;
		font-size: 17px;
		letter-spacing: -0.01em;
	}
	.n {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 13px;
		margin-left: 6px;
	}
	.bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 12px;
	}
	/* Same look as the search box in the views' filter bar. */
	.search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-2);
		color: var(--text-muted);
	}
	.search:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: -1px;
	}
	.search input {
		border: 0;
		background: transparent;
		outline: none;
		width: 170px;
		font-size: 13px;
		color: var(--text-primary);
	}
	.bar :global(.btn.filter) {
		height: 28px;
		color: var(--text-secondary);
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
		display: inline-block;
	}
	.bar :global(.btn.filter.on) {
		background: var(--selected);
		border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
		color: var(--text-primary);
	}
	.spacer {
		flex: 1;
	}
	.toggle,
	.group {
		font-size: 13px;
		color: var(--text-secondary);
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.group {
		margin-left: 8px;
	}
	.group select {
		height: 28px;
	}
	.table {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.tr {
		display: grid;
		grid-template-columns: var(--cols);
		gap: 16px;
		align-items: center;
		padding: 0 16px;
		min-height: 44px;
		border-bottom: 1px solid var(--grid);
		color: var(--text-primary);
		text-decoration: none;
		font-size: 13.5px;
	}
	.table > :last-child {
		border-bottom: 0;
	}
	a.tr:hover {
		background: var(--hover);
	}
	a.tr:focus-visible {
		outline-offset: -2px;
	}
	.tr.closed .title {
		color: var(--text-muted);
	}
	.th {
		min-height: 34px;
		font-size: 12px;
		color: var(--text-muted);
		font-weight: 600;
		background: color-mix(in srgb, var(--surface-0) 60%, var(--surface-1));
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		/* The padding gives a bigger click target; the margin keeps the text on the column's edge. */
		margin: 0 -6px;
		padding: 4px 6px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		font-size: inherit;
		font-weight: inherit;
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.sort:hover,
	.sort.on {
		color: var(--text-primary);
	}
	.sort:hover {
		background: var(--hover);
	}
	.arrow {
		flex: none;
		visibility: hidden;
	}
	.sort.on .arrow {
		visibility: visible;
		color: var(--accent);
	}
	.sort:hover:not(.on) .arrow {
		visibility: visible;
		opacity: 0.45;
	}
	.arrow.desc {
		transform: rotate(180deg);
	}
	.sort:not(.on) .arrow.desc {
		transform: none;
	}
	.gh {
		display: flex;
		align-items: center;
		min-height: 34px;
		padding: 0 16px;
		border-bottom: 1px solid var(--grid);
		background: color-mix(in srgb, var(--surface-0) 35%, var(--surface-1));
		font-size: 13px;
	}
	.gh > span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.gl {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.gn {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.title {
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ref {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.status,
	.people {
		display: flex;
		align-items: center;
		min-width: 0;
		color: var(--text-secondary);
	}
	.status {
		gap: 7px;
	}
	.people {
		gap: 2px;
	}
	.clip {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.more {
		font-size: 11.5px;
		color: var(--text-muted);
		margin-left: 3px;
	}
	.none {
		color: var(--text-muted);
	}
	.num,
	.date {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 36px 24px;
		color: var(--text-muted);
		font-size: 14px;
	}
	.empty p {
		margin: 0;
	}
	.foot {
		font-size: 12.5px;
		margin-top: 10px;
	}
	@media (max-width: 860px) {
		.table {
			--cols: minmax(0, 1fr) 140px !important;
		}
		.tr > :is(.c-status, .c-people, .c-open, .c-start, .c-due) {
			display: none;
		}
		.spacer {
			display: none;
		}
		.group {
			margin-left: 0;
		}
	}
</style>
