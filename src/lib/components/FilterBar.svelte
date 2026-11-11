<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import type { RuleReport } from '$lib/query/engine';
	import { addRule, menuFields, refOf, removeRuleAt } from '$lib/query/edit';
	import type { Cmp, FilterGroup } from '$lib/query/types';
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

	let open = $state(false);
	let field = $state<FieldDef | null>(null);
	let picked = $state<string[]>([]);
	let exclude = $state(false);
	let cmp = $state<Cmp>('is');
	let text = $state('');

	$effect(() => {
		if (!open) reset();
	});

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

	function apply(close: () => void, special?: 'empty' | 'notEmpty') {
		if (!field) return;
		let rule;
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
		onchange(addRule(filter, rule));
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
			type="search"
			placeholder="Search"
			value={search}
			oninput={(e) => onsearch((e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => e.key === 'Escape' && (e.currentTarget as HTMLInputElement).blur()}
		/>
	</label>

	{#if filter.op === 'or' && reports.length > 1}<span class="op">Any of:</span>{/if}
	{#each reports as r (r.path.join('.'))}
		<span
			class="chip"
			class:broken={!!r.broken}
			class:partial={!!r.partial}
			title={r.broken ? `${r.broken}: this rule is ignored` : r.partial ? `${r.partial}; the rest still applies` : r.text}
		>
			{#if r.broken}<span class="warn" aria-hidden="true">⚠</span>{:else if r.partial}<span class="warn" aria-hidden="true">!</span>{/if}
			<span class="txt">{r.text}</span>
			{#if r.broken}<span class="visually-hidden">({r.broken}, ignored)</span>{/if}
			{#if !readOnly}
				<button type="button" class="x" aria-label="Remove filter: {r.text}" onclick={() => onchange(removeRuleAt(filter, r.path))}>×</button>
			{/if}
		</span>
	{/each}

	{#if !readOnly}
		<Popover bind:open label="Add filter" triggerClass="btn ghost add" width="300px">
			{#snippet trigger()}<span aria-hidden="true">+</span> Filter{/snippet}
			{#snippet children(close)}
				{#if !field}
					<div class="menu-label">Filter by</div>
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
								onkeydown={(e) => e.key === 'Enter' && apply(close)}
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
						<button type="button" class="btn small" onclick={() => apply(close, 'empty')}>Is empty</button>
						<button type="button" class="btn small" onclick={() => apply(close, 'notEmpty')}>Is set</button>
						<button type="button" class="btn primary small" onclick={() => apply(close)}>Apply</button>
					</div>
				{/if}
			{/snippet}
		</Popover>
	{/if}
</div>

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
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 26px;
		padding: 0 4px 0 9px;
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
