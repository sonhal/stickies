<script lang="ts">
	import { untrack } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import type { RuleReport } from '$lib/query/engine';
	import {
		appendProblem,
		appendRule,
		combineProblem,
		combineRuleAt,
		menuFields,
		refOf,
		removeRuleAt,
		setOpAt,
		toggleOpAt
	} from '$lib/query/edit';
	import { isGroup, type Cmp, type FilterGroup, type FilterRule } from '$lib/query/types';
	import type { FieldDef } from '$lib/fields/types';
	import { orderedOptions } from '$lib/fields/registry';
	import Popover from './ui/Popover.svelte';
	import OptionPicker, { type PickOption } from './ui/OptionPicker.svelte';
	import StatusIcon from './ui/StatusIcon.svelte';

	interface Props {
		filter: FilterGroup;
		reports: RuleReport[];
		search: string;
		readOnly?: boolean;
		onchange: (f: FilterGroup) => void;
		onsearch: (q: string) => void;
	}

	let { filter, reports, search, readOnly = false, onchange, onsearch }: Props = $props();
	const board = getBoard();
	const ui = getUi();

	/**
	 * Which add-filter popup is open: 'add' (the "+ Filter" button), or one that belongs to a chip
	 * or a group. They share the picker state below, so only one is open at a time.
	 */
	let openKey = $state<string | null>(null);
	let searchInput: HTMLInputElement | undefined = $state();
	let field = $state<FieldDef | null>(null);
	let picked = $state<string[]>([]);
	let exclude = $state(false);
	let cmp = $state<Cmp>('is');
	let text = $state('');

	$effect(() => {
		if (openKey === null) reset();
	});

	function setOpen(key: string, v: boolean) {
		if (v) {
			reset();
			openKey = key;
		} else if (openKey === key) openKey = null;
	}

	// Keyboard shortcuts ("/" and "F", wired in the layout) ask through these counters. Each effect
	// depends on its counter only, and remembers the value it started with so it doesn't fire on mount.
	let seenSearch = untrack(() => ui.searchRequest);
	$effect(() => {
		const n = ui.searchRequest;
		if (n === seenSearch) return;
		seenSearch = n;
		if (n > 0)
			untrack(() => {
				searchInput?.focus();
				searchInput?.select();
			});
	});
	let seenFilter = untrack(() => ui.filterRequest);
	$effect(() => {
		const n = ui.filterRequest;
		if (n === seenFilter) return;
		seenFilter = n;
		if (n > 0)
			untrack(() => {
				// The field search in the picker focuses itself when it appears
				if (!readOnly && !addProblem) setOpen('add', true);
			});
	});

	/** The engine's report for each rule, by its path, so chips can be drawn following the tree. */
	const byPath = $derived(new Map(reports.map((r) => [r.path.join('.'), r])));
	/** Why nothing more can be added (the view would fail validation), or null */
	const addProblem = $derived(appendProblem(filter));
	const otherOp = (op: FilterGroup['op']) => (op === 'and' ? 'or' : 'and');
	/** The combine actions a chip offers, by the operator of the group it sits in */
	const chipOps = (parentOp: FilterGroup['op']): FilterGroup['op'][] => (parentOp === 'or' ? ['or', 'and'] : ['or']);

	function reset() {
		field = null;
		picked = [];
		exclude = false;
		cmp = 'is';
		text = '';
	}

	const fieldOptions = $derived(
		menuFields(board.reg).map((f) => ({ id: f.key, label: f.name, hint: f.rawType ? 'unknown type' : kindLabel(f) }))
	);

	function kindLabel(f: FieldDef): string {
		return { singleSelect: 'select', multiSelect: 'multi-select', number: 'number', text: 'text', date: 'date', people: 'people', ref: 'link', status: 'status' }[f.kind];
	}

	const isOptionKind = (f: FieldDef) => ['singleSelect', 'multiSelect', 'status', 'ref', 'people'].includes(f.kind);

	const valueOptions = $derived.by((): PickOption[] => {
		if (!field) return [];
		if (field.kind === 'people') {
			return [
				...(board.reg.currentUserId ? [{ id: 'me', label: 'Me', hint: 'whoever is signed in' }] : []),
				...board.reg.people.map((p) => ({ id: p.id, label: p.name, hint: `@${p.username}` }))
			];
		}
		const opts = orderedOptions(field).map((o) => ({ id: o.id, label: o.label, hint: o.hint, color: o.color }));
		if (field.kind === 'status') {
			const cats = [...new Set(field.options?.map((o) => o.category).filter(Boolean))];
			return [...opts, ...cats.map((c) => ({ id: `category:${c}`, label: `Any "${c}" status`, hint: 'category' }))];
		}
		return opts;
	});

	function pickField(key: string) {
		field = board.reg.fields.find((f) => f.key === key) ?? null;
		cmp = field?.kind === 'date' ? 'before' : field?.kind === 'text' ? 'contains' : 'is';
	}

	function toggle(id: string) {
		picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
	}

	/** What applying the picker does with the new rule: append it, or combine it with a chip's rule */
	type Commit = (rule: FilterRule) => FilterGroup;

	function apply(close: () => void, commit: Commit, special?: 'empty' | 'notEmpty') {
		if (!field) return;
		let rule: FilterRule;
		if (special) rule = { field: refOf(field), cmp: special };
		else if (isOptionKind(field)) {
			if (!picked.length) return;
			rule = { field: refOf(field), cmp: (exclude ? 'noneOf' : 'anyOf') as Cmp, value: picked };
		} else if (field.kind === 'number') {
			const n = Number(text);
			if (!text.trim() || !Number.isFinite(n)) return;
			rule = { field: refOf(field), cmp, value: n };
		} else {
			if (!text.trim()) return;
			rule = { field: refOf(field), cmp, value: text.trim().slice(0, 200) };
		}
		onchange(commit(rule));
		close();
	}

	const cmpChoices = $derived(
		field?.kind === 'number'
			? [
					['is', '='],
					['gt', '>'],
					['lt', '<'],
					['isNot', '≠']
				]
			: field?.kind === 'date'
				? [
						['before', 'before'],
						['after', 'after'],
						['is', 'on']
					]
				: [
						['contains', 'contains'],
						['is', 'is'],
						['isNot', 'is not']
					]
	);
</script>

<div class="filterbar">
	<label class="search">
		<span class="visually-hidden">Search titles</span>
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
			placeholder="Search"
			value={search}
			oninput={(e) => onsearch((e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => e.key === 'Escape' && (e.currentTarget as HTMLInputElement).blur()}
		/>
	</label>

	{#if filter.rules.length > 1}
		{#if readOnly}
			<span class="op">Match {filter.op === 'or' ? 'any' : 'all'}:</span>
		{:else}
			<span class="match" role="group" aria-label="Match all or any of the filters">
				<span class="op">Match</span>
				{#each [['and', 'all'], ['or', 'any']] as const as [op, label] (op)}
					<button
						type="button"
						aria-pressed={filter.op === op}
						title={op === 'and' ? 'Show items that match every filter' : 'Show items that match at least one filter'}
						onclick={() => onchange(setOpAt(filter, [], op))}>{label}</button
					>
				{/each}
			</span>
		{/if}
	{/if}

	{@render entries(filter, [])}

	{#if !readOnly}
		<Popover
			bind:open={() => openKey === 'add', (v) => setOpen('add', v)}
			label="Add filter"
			triggerClass="btn ghost add"
			triggerTitle={addProblem ?? undefined}
			disabled={!!addProblem}
			width="300px"
		>
			{#snippet trigger()}<span aria-hidden="true">+</span> Filter{/snippet}
			{#snippet children(close)}{@render picker(close, (rule) => appendRule(filter, rule), 'Filter by')}{/snippet}
		</Popover>
	{/if}
</div>

<!-- The entries of one group, in tree order. A nested group is drawn as a bordered cluster with
	its operator between the entries; the top level's operator is the "Match" control instead. -->
{#snippet entries(g: FilterGroup, path: number[])}
	{#each g.rules as r, i (i)}
		{@const p = [...path, i]}
		{#if i > 0 && path.length > 0}
			{#if readOnly}
				<span class="join">{g.op}</span>
			{:else}
				<button
					type="button"
					class="join"
					title="Switch this group to &quot;{otherOp(g.op)}&quot;"
					aria-label="{g.op}: switch this group to {otherOp(g.op)}"
					onclick={() => onchange(toggleOpAt(filter, path))}>{g.op}</button
				>
			{/if}
		{/if}
		{#if isGroup(r)}
			<span class="group" role="group" aria-label={r.op === 'or' ? 'Any of these filters' : 'All of these filters'}>
				{@render entries(r, p)}
			</span>
		{:else}
			{@const rep = byPath.get(p.join('.'))}
			{#if rep}{@render chip(rep, g.op)}{/if}
		{/if}
	{/each}
{/snippet}

<!-- Each chip offers "or…" (an alternative to this filter). Inside an "or" group it also offers
	"and…", so one alternative can be narrowed without leaving the group. -->
{#snippet chip(r: RuleReport, parentOp: FilterGroup['op'])}
	{@const tip = r.broken ? `${r.broken}: this rule is ignored` : r.partial ? `${r.partial}; the rest still applies` : r.text}
	<span class="chip" class:broken={!!r.broken} class:partial={!!r.partial} title={tip}>
		{#if r.broken}<span class="warn" aria-hidden="true">⚠</span>{:else if r.partial}<span class="warn" aria-hidden="true">!</span>{/if}
		<span class="txt">{r.text}</span>
		{#if r.broken}<span class="visually-hidden">({r.broken}, ignored)</span>{/if}
		{#if !readOnly}
			<span class="acts">
			{#each chipOps(parentOp) as op (op)}
				{@const key = `${op}:${r.path.join('.')}`}
				{@const problem = combineProblem(filter, r.path, op)}
				<Popover
					bind:open={() => openKey === key, (v) => setOpen(key, v)}
					label={op === 'or' ? 'Add an alternative filter' : 'Add a filter that must also match'}
					triggerClass="chip-act"
					triggerTitle={problem ?? (op === 'or' ? 'Match this or another filter' : 'Match this and another filter')}
					disabled={!!problem}
					width="300px"
				>
					{#snippet trigger()}{op}…<span class="visually-hidden"> (combine “{r.text}” with another filter)</span>{/snippet}
					{#snippet children(close)}
						{@render picker(close, (rule) => combineRuleAt(filter, r.path, rule, op), op === 'or' ? 'Or filter by' : 'And filter by')}
					{/snippet}
				</Popover>
			{/each}
			</span>
			<button type="button" class="x" aria-label="Remove filter: {r.text}" onclick={() => onchange(removeRuleAt(filter, r.path))}>×</button>
		{/if}
	</span>
{/snippet}

{#snippet picker(close: () => void, commit: Commit, heading: string)}
	{#if !field}
		<div class="menu-label">{heading}</div>
		<OptionPicker options={fieldOptions} placeholder="Field…" onpick={pickField} />
	{:else}
		<div class="step">
			<button type="button" class="btn ghost small" onclick={() => (field = null)}>← {field.name}</button>
			{#if isOptionKind(field)}
				<label class="ex"><input type="checkbox" bind:checked={exclude} /> exclude</label>
			{/if}
		</div>
		{#if isOptionKind(field)}
			<OptionPicker options={valueOptions} multi selected={picked} placeholder="{field.name}…" onpick={toggle}>
				{#snippet icon(o)}
					{#if field?.kind === 'status' && !o.id.startsWith('category:')}
						<StatusIcon status={field.options?.find((x) => x.id === o.id) ?? null} size={12} />
					{:else if o.color}<span class="dot" style="background: {o.color}"></span>{/if}
				{/snippet}
			</OptionPicker>
		{:else}
			<div class="row">
				<select class="input" bind:value={cmp} aria-label="Comparison">
					{#each cmpChoices as [k, l] (k)}<option value={k}>{l}</option>{/each}
				</select>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input grow"
					autofocus
					type={field.kind === 'number' ? 'number' : 'text'}
					bind:value={text}
					placeholder={field.kind === 'date' ? 'YYYY-MM-DD or today+7' : 'Value'}
					aria-label="Value"
					onkeydown={(e) => e.key === 'Enter' && apply(close, commit)}
				/>
			</div>
			{#if field.kind === 'date'}
				<div class="quick">
					{#each ['today', 'today+7', 'today+14', 'today-7'] as q (q)}
						<button type="button" class="btn small" onclick={() => (text = q)}>{q}</button>
					{/each}
				</div>
			{/if}
		{/if}
		<div class="actions">
			<button type="button" class="btn small" onclick={() => apply(close, commit, 'empty')}>Is empty</button>
			<button type="button" class="btn small" onclick={() => apply(close, commit, 'notEmpty')}>Is set</button>
			<button type="button" class="btn primary small" onclick={() => apply(close, commit)}>Apply</button>
		</div>
	{/if}
{/snippet}

<style>
	.filterbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		min-width: 0;
	}
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
	.search input {
		border: 0;
		background: transparent;
		outline: none;
		width: 130px;
		font-size: 13px;
		color: var(--text-primary);
	}
	.op {
		font-size: 12px;
		color: var(--text-muted);
	}
	.match {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 26px;
	}
	.match .op {
		margin-right: 3px;
	}
	.match button {
		height: 22px;
		padding: 0 7px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
	}
	.match button:hover {
		background: var(--hover);
	}
	.match button[aria-pressed='true'] {
		border-color: var(--border);
		background: var(--surface-2);
		color: var(--text-primary);
		font-weight: 600;
	}
	/* A nested group: its chips sit together in one bordered cluster */
	.group {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: var(--hover);
		min-width: 0;
	}
	.group .group {
		background: var(--surface-1);
	}
	.join {
		border: 0;
		background: none;
		padding: 2px 5px;
		border-radius: 5px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	button.join {
		cursor: pointer;
	}
	button.join:hover {
		background: var(--hover);
		color: var(--accent);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 26px;
		padding: 0 4px 0 9px;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-2);
		font-size: 12.5px;
		max-width: 340px;
	}
	.txt {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip.broken .txt {
		text-decoration: line-through;
		color: var(--text-muted);
	}
	.chip.broken {
		border-style: dashed;
	}
	.warn {
		color: var(--danger);
		font-weight: 700;
	}
	.chip.partial .warn {
		color: #b07400;
	}
	/* The small "or…" / "and…" actions inside a chip; the class goes to the Popover's trigger */
	.acts {
		display: inline-flex;
		align-items: center;
		align-self: stretch;
		margin-left: 3px;
		padding-left: 3px;
		border-left: 1px solid var(--grid);
	}
	.filterbar :global(.chip-act) {
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--text-muted);
		font-size: 11.5px;
		line-height: 1;
		height: 20px;
		padding: 0 4px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.filterbar :global(.chip-act:hover:not(:disabled)),
	.filterbar :global(.chip-act[aria-expanded='true']) {
		background: var(--hover);
		color: var(--text-primary);
	}
	.filterbar :global(.chip-act:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.x {
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--text-muted);
		font-size: 15px;
		line-height: 1;
		padding: 0 4px;
		border-radius: 4px;
	}
	.x:hover {
		background: var(--hover);
		color: var(--text-primary);
	}
	.step {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}
	.ex {
		font-size: 12px;
		color: var(--text-secondary);
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	.row {
		display: flex;
		gap: 6px;
	}
	.grow {
		flex: 1;
	}
	.quick {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-top: 6px;
	}
	.actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--grid);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}
	:global(.btn.add) {
		height: 26px;
		color: var(--text-secondary);
	}
</style>
