<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { bulkEditable, countLabel, isMulti, optionCounts, type BulkOp } from '$lib/client/bulk';
	import { applyBulk } from '$lib/client/bulkApply';
	import { appliesTo, orderedOptions } from '$lib/fields/registry';
	import { labelScope } from '$lib/fields/apply';
	import type { FieldDef, FieldKey, WorkItem } from '$lib/fields/types';
	import Popover from './ui/Popover.svelte';
	import OptionPicker, { type PickOption } from './ui/OptionPicker.svelte';

	/**
	 * Floating bar for the checked items (ui.selection): set status, assignees, labels or any other
	 * option field on all of them at once. Every change goes through board.updateMany (optimistic,
	 * one undo step, validated per item on the server).
	 */
	const board = getBoard();
	const ui = getUi();

	const items = $derived([...ui.selection].map((id) => board.byId.get(id)).filter((i): i is WorkItem => !!i));
	/** Fields that can be bulk-edited and apply to at least one checked item */
	const fields = $derived(board.reg.fields.filter((f) => bulkEditable(f) && items.some((i) => appliesTo(f, i.type))));
	const PRIMARY: FieldKey[] = ['native:status', 'native:assignees', 'native:labels'];
	const primary = $derived(PRIMARY.map((k) => fields.find((f) => f.key === k)).filter((f): f is FieldDef => !!f));
	const more = $derived(fields.filter((f) => !PRIMARY.includes(f.key)));

	// Every key starts as false: bind:open can't take undefined (Popover has a default).
	const open = $state<Record<string, boolean>>({ 'native:status': false, 'native:assignees': false, 'native:labels': false, more: false });
	/** The field chosen under "More" (its options show in the same popover) */
	let moreField = $state<FieldDef | null>(null);

	// s / a / l (and the palette) with items checked open the matching picker here.
	let lastReq = 0;
	$effect(() => {
		const r = ui.bulkRequest;
		if (!r || r.n === lastReq) return;
		lastReq = r.n;
		const f = fields.find((x) => x.key === r.field);
		if (!f) return ui.toast(`None of the selected items has ${board.field(r.field)?.name ?? 'that field'}`);
		for (const k of Object.keys(open)) open[k] = false;
		if (PRIMARY.includes(f.key)) open[f.key] = true;
		else {
			moreField = f;
			open.more = true;
		}
	});
	$effect(() => {
		if (!open.more) moreField = null;
	});

	function optionsFor(f: FieldDef): PickOption[] {
		const n = items.length;
		const counts = optionCounts(items, f);
		const share = (id: string) => {
			const c = counts.get(id) ?? 0;
			return c > 0 && c < n ? `${c} of ${n}` : undefined;
		};
		let list: PickOption[];
		if (f.kind === 'people') list = board.reg.people.map((p) => ({ id: p.id, label: p.name, hint: share(p.id) ?? `@${p.username}` }));
		else if (f.key === 'native:parent') {
			// Parents GitLab allows for any of the checked types, never one of the checked items
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, rebuilt on every call
			const seen = new Set(ui.selection);
			list = [];
			for (const t of new Set(items.map((i) => i.type)))
				for (const o of board.parentChoices(t)) {
					if (seen.has(o.id)) continue;
					seen.add(o.id);
					list.push({ id: o.id, label: o.label, hint: share(o.id) ?? o.hint });
				}
		} else
			list = orderedOptions(f).map((o) => ({
				id: o.id,
				label: o.label,
				color: o.color,
				hint: share(o.id) ?? o.hint ?? (f.key === 'native:labels' && labelScope(o.label) ? 'replaces its scope' : undefined)
			}));
		if (!isMulti(f) && f.kind !== 'status') list.unshift({ id: '__none', label: `No ${f.name.toLowerCase()}` });
		return list;
	}

	/** Options every checked item has: ✓ in the picker; picking one of those takes it off everyone */
	function onAll(f: FieldDef): string[] {
		const counts = optionCounts(items, f);
		return [...counts].filter(([, c]) => c === items.length).map(([id]) => id);
	}

	function pick(f: FieldDef, id: string, close: () => void) {
		let op: BulkOp;
		if (isMulti(f)) op = onAll(f).includes(id) ? { kind: 'remove', id } : { kind: 'add', id };
		else {
			op = { kind: 'set', value: id === '__none' ? null : id };
			close();
		}
		applyBulk(board, (t) => ui.toast(t), items, f, op);
	}

	function onKey(e: KeyboardEvent) {
		// Esc in an open picker is the picker's own (Popover); otherwise the shell clears the selection.
		if (e.key === 'Escape' && !Object.values(open).some(Boolean)) {
			e.preventDefault();
			ui.clearSelection();
		}
	}
</script>

{#snippet picker(f: FieldDef, close: () => void)}
	<OptionPicker
		options={optionsFor(f)}
		selected={onAll(f)}
		multi={isMulti(f)}
		placeholder={isMulti(f) ? `Add or remove ${f.name.toLowerCase()}…` : `Set ${f.name.toLowerCase()}…`}
		onpick={(id) => pick(f, id, close)}
	/>
{/snippet}

{#if items.length}
	<div class="bulk" role="toolbar" aria-label="Edit {countLabel(items)}" tabindex="-1" onkeydown={onKey}>
		<span class="count" aria-live="polite"><strong>{items.length}</strong> selected</span>
		<span class="sep" aria-hidden="true"></span>
		{#each primary as f (f.key)}
			<Popover label="{f.name} for {countLabel(items)}" bind:open={open[f.key]} triggerClass="btn ghost small" up width="300px">
				{#snippet trigger()}{f.name}{/snippet}
				{#snippet children(close)}{@render picker(f, close)}{/snippet}
			</Popover>
		{/each}
		{#if more.length}
			<Popover label="More fields for {countLabel(items)}" bind:open={open.more} triggerClass="btn ghost small" up width="300px">
				{#snippet trigger()}More…{/snippet}
				{#snippet children(close)}
					{#if moreField}
						{@const f = moreField}
						<button type="button" class="back menu-item" onclick={() => (moreField = null)}>‹ {f.name}</button>
						{@render picker(f, close)}
					{:else}
						<div class="menu" role="menu">
							{#each more as f (f.key)}
								<button type="button" class="menu-item" role="menuitem" onclick={() => (moreField = f)}>{f.name}</button>
							{/each}
						</div>
					{/if}
				{/snippet}
			</Popover>
		{/if}
		<span class="sep" aria-hidden="true"></span>
		<button type="button" class="btn ghost small" onclick={() => ui.clearSelection()} title="Clear selection (Esc)">Clear</button>
	</div>
{/if}

<style>
	.bulk {
		position: fixed;
		left: 50%;
		bottom: 16px;
		transform: translateX(-50%);
		z-index: 45;
		display: flex;
		align-items: center;
		gap: 4px;
		max-width: calc(100vw - 32px);
		padding: 6px 8px 6px 14px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		box-shadow: var(--shadow-pop);
		font-size: 13px;
	}
	.count {
		white-space: nowrap;
		color: var(--text-secondary);
	}
	.count strong {
		color: var(--text-primary);
	}
	.sep {
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: var(--border);
	}
	.back {
		width: 100%;
		font-weight: 600;
		margin-bottom: 4px;
	}
	@media (max-width: 560px) {
		.bulk {
			flex-wrap: wrap;
			justify-content: center;
		}
	}
</style>
