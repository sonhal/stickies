<script lang="ts">
	import { untrack } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { appliesTo, optionById, orderedOptions, valueIds } from '$lib/fields/registry';
	import { toggleLabel, labelScope } from '$lib/fields/apply';
	import type { FieldKey, WorkItem } from '$lib/fields/types';
	import Popover from './ui/Popover.svelte';
	import OptionPicker, { type PickOption } from './ui/OptionPicker.svelte';
	import StatusIcon from './ui/StatusIcon.svelte';
	import ValueChip from './ui/ValueChip.svelte';

	/**
	 * Inline editor for one field of one item. Read-only (plain value) when the field isn't
	 * editable, doesn't apply to this type, or the viewer is the kiosk. Every edit goes through
	 * board.update (optimistic, rolled back on error); the server re-validates it.
	 */
	let { key, item }: { key: FieldKey; item: WorkItem } = $props();
	const board = getBoard();
	const ui = getUi();

	const field = $derived(board.field(key));
	const editable = $derived(!!field && field.editable && !ui.readOnly && appliesTo(field, item.type));
	const value = $derived(item.values[key]);
	const ids = $derived(valueIds(value));
	let open = $state(false);
	let draft = $state('');

	// Keyboard shortcuts (s, a, l, w) open the matching editor in the panel. Only requests made
	// after this editor appeared: a new editor (another page, the panel re-opening) must not replay
	// an old one and pop open on its own.
	let lastReq = untrack(() => ui.editRequest?.n ?? 0);
	$effect(() => {
		const r = ui.editRequest;
		if (r && r.n !== lastReq && r.field === key && ui.selectedId === item.id && editable) {
			lastReq = r.n;
			openEditor();
		}
	});

	function openEditor() {
		if (field?.kind === 'number' || field?.kind === 'text' || field?.kind === 'date') {
			draft = value && 'value' in value ? String(value.value).slice(0, field.kind === 'date' ? 10 : undefined) : '';
		}
		open = true;
	}
	$effect(() => {
		if (open && field && ['number', 'text', 'date'].includes(field.kind)) {
			draft = value && 'value' in value ? String(value.value).slice(0, field.kind === 'date' ? 10 : undefined) : '';
		}
	});

	const options = $derived.by((): PickOption[] => {
		if (!field) return [];
		if (field.kind === 'people') return board.reg.people.map((p) => ({ id: p.id, label: p.name, hint: `@${p.username}` }));
		if (field.key === 'native:parent') {
			// Only parents GitLab allows for this type (an issue under an epic, a task under an issue)
			return board
				.parentChoices(item.type, item.parentId)
				.filter((o) => o.id !== item.id && board.byId.get(o.id)?.parentId !== item.id)
				.map((o) => ({ id: o.id, label: o.label, hint: o.hint }));
		}
		return orderedOptions(field).map((o) => {
			const scope = field.key === 'native:labels' ? labelScope(o.label) : null;
			const clash = scope && !ids.includes(o.id) && ids.some((x) => labelScope(optionById(field, x)?.label ?? '') === scope);
			return { id: o.id, label: o.label, hint: o.hint, color: o.color, note: clash ? `replaces ${scope}::` : undefined };
		});
	});

	const multi = $derived(field?.kind === 'multiSelect' || field?.kind === 'people');
	const clearable = $derived(field?.kind !== 'status');

	function pick(id: string, close: () => void) {
		if (!field) return;
		if (multi) {
			const next = field.key === 'native:labels' ? toggleLabel(field, ids, id) : ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
			board.update(item.id, key, next);
			return;
		}
		if (id === '__none') board.update(item.id, key, null);
		else if (!ids.includes(id)) board.update(item.id, key, id);
		close();
	}

	function saveScalar(close: () => void, clear = false) {
		if (!field) return;
		if (clear || draft.trim() === '') board.update(item.id, key, null);
		else if (field.kind === 'number') {
			const n = Number(draft);
			if (!Number.isFinite(n)) return;
			board.update(item.id, key, n);
		} else board.update(item.id, key, draft.trim());
		close();
	}

	function quickDate(days: number) {
		const d = new Date(Date.now() + days * 86_400_000);
		draft = d.toISOString().slice(0, 10);
	}
</script>

{#snippet shown()}
	{#if field && value && board.text(item, key)}
		{#if field.kind === 'people' || field.kind === 'status' || field.key === 'native:labels'}
			<span class="chips"><ValueChip {field} {item} /></span>
			{#if field.kind === 'people'}<span class="names">{board.text(item, key)}</span>{/if}
		{:else}
			<span class="txt">{board.text(item, key)}</span>
		{/if}
	{:else}
		<span class="empty">{editable ? 'Set…' : '—'}</span>
	{/if}
{/snippet}

{#if !field}
	<span class="empty">—</span>
{:else if !editable}
	<span class="ro" title={field.rawType ? `Unknown field type ${field.rawType}: read-only` : undefined}>{@render shown()}</span>
{:else}
	<Popover bind:open label="Edit {field.name}" triggerClass="edit" width={field.kind === 'number' || field.kind === 'text' || field.kind === 'date' ? '260px' : '280px'}>
		{#snippet trigger()}{@render shown()}{/snippet}
		{#snippet children(close)}
			{#if field.kind === 'number' || field.kind === 'text' || field.kind === 'date'}
				<form
					class="scalar"
					onsubmit={(e) => {
						e.preventDefault();
						saveScalar(close);
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input"
						autofocus
						aria-label={field.name}
						type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
						min={field.key === 'native:weight' ? 0 : undefined}
						step={field.key === 'native:weight' ? 1 : 'any'}
						maxlength={field.kind === 'text' ? 1024 : undefined}
						bind:value={draft}
					/>
					{#if field.kind === 'date'}
						<div class="quick">
							<button type="button" class="btn small" onclick={() => quickDate(0)}>Today</button>
							<button type="button" class="btn small" onclick={() => quickDate(1)}>Tomorrow</button>
							<button type="button" class="btn small" onclick={() => quickDate(7)}>+1 week</button>
							<button type="button" class="btn small" onclick={() => quickDate(14)}>+2 weeks</button>
						</div>
					{/if}
					<div class="row">
						<button type="button" class="btn small" onclick={() => saveScalar(close, true)}>Clear</button>
						<button class="btn primary small">Save</button>
					</div>
				</form>
			{:else}
				<OptionPicker
					options={!multi && clearable ? [{ id: '__none', label: field.key === 'native:parent' ? 'Remove parent' : `No ${field.name.toLowerCase()}` }, ...options] : options}
					selected={ids}
					{multi}
					placeholder="{field.name}…"
					onpick={(id) => pick(id, close)}
				>
					{#snippet icon(o)}
						{#if field.kind === 'status'}<StatusIcon status={optionById(field, o.id)} size={12} />
						{:else if o.color}<span class="dot" style="background: {o.color}"></span>{/if}
					{/snippet}
				</OptionPicker>
			{/if}
		{/snippet}
	</Popover>
{/if}

<style>
	:global(button.edit) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 28px;
		padding: 2px 6px;
		margin-left: -6px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}
	:global(button.edit:hover) {
		background: var(--hover);
		border-color: var(--border);
	}
	.ro {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.names,
	.txt {
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.empty {
		color: var(--text-muted);
		white-space: nowrap;
	}
	.scalar {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 4px;
	}
	.row {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}
	.quick {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}
</style>
