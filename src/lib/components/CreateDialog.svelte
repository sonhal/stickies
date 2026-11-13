<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi, type CreatePrefill } from '$lib/client/ui.svelte';
	import { appliesTo, childTypesOf, optionById, orderedOptions } from '$lib/fields/registry';
	import type { WriteValue } from '$lib/fields/apply';
	import { prefillToWrite } from '$lib/query/edit';
	import type { FieldKey } from '$lib/fields/types';

	/** "Create issue" or "Create epic", pre-filled from the current view's filters and group, like Linear. */
	let { prefill, onclose }: { prefill: CreatePrefill; onclose: () => void } = $props();
	const board = getBoard();
	const ui = getUi();

	// svelte-ignore state_referenced_locally
	const initial = prefill;
	let title = $state('');
	let description = $state('');
	let projectId = $state(initial.projectId ?? board.reg.projects[0]?.id ?? '');
	const typeNamed = (name: string) => board.reg.types.find((t) => t.name.toLowerCase() === name.toLowerCase())?.name;
	// "New epic" asks for the Epic type; a type the group doesn't have falls back to Issue. Created
	// under a parent ("+ Add task"), it starts as the first type GitLab allows there (Issue → Task).
	const parentType = initial.parentId ? board.byId.get(initial.parentId)?.type : undefined;
	let type = $state(
		(initial.type && typeNamed(initial.type)) ||
			(parentType && childTypesOf(board.reg, parentType)[0]) ||
			typeNamed('Issue') ||
			board.reg.types[0]?.name ||
			'Issue'
	);
	let statusId = $state((initial.values?.['native:status'] as string | undefined) ?? '');
	let assignee = $state((initial.values?.['native:assignees'] as string | undefined) ?? '');
	let parentId = $state(initial.parentId ?? '');
	let extra = $state<Partial<Record<FieldKey, string>>>(
		Object.fromEntries(
			Object.entries(initial.values ?? {}).filter(
				([k]) => !['native:status', 'native:assignees', 'native:parent', 'native:project', 'native:type'].includes(k)
			)
		)
	);
	let busy = $state(false);
	let dialog: HTMLDialogElement | undefined = $state();

	// An epic lives in the group, not in a project. The server decides which group; this only shows it.
	const isEpic = $derived(type.toLowerCase() === 'epic');
	const noun = $derived(type.toLowerCase());
	const statusField = $derived(board.field('native:status'));
	const assigneeField = $derived(board.field('native:assignees'));
	const parentField = $derived(board.field('native:parent'));
	// GitLab's hierarchy decides the possible parents: an epic or issue under an epic, a task under an issue.
	const parentOptions = $derived(parentField ? board.parentChoices(type, initial.parentId) : []);
	const canAssign = $derived(!!assigneeField && appliesTo(assigneeField, type));
	const statusOptions = $derived(statusField && appliesTo(statusField, type) ? orderedOptions(statusField) : []);
	const extras = $derived(
		Object.entries(extra).flatMap(([k, id]) => {
			const f = board.field(k as FieldKey);
			if (!f || !id || !f.editable) return [];
			const label = f.kind === 'people' ? (board.reg.people.find((p) => p.id === id)?.name ?? id) : (optionById(f, id)?.label ?? id);
			return [{ key: k as FieldKey, name: f.name, label, applies: appliesTo(f, type) }];
		})
	);

	$effect(() => {
		dialog?.showModal();
	});

	/** A parent picked for an issue may not be allowed for an epic: drop it rather than send it. */
	function typeChanged() {
		if (parentId && !parentOptions.some((o) => o.id === parentId)) parentId = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!title.trim() || (!isEpic && !projectId) || busy) return;
		busy = true;
		const values: Record<string, WriteValue> = {};
		for (const x of extras) {
			const f = board.field(x.key);
			const v = f && x.applies ? prefillToWrite(f, extra[x.key]!) : null;
			if (v !== null) values[x.key] = v;
		}
		if (statusId && statusOptions.length) values['native:status'] = statusId;
		if (assignee && canAssign) values['native:assignees'] = [assignee];
		const item = await board.create({
			title: title.trim(),
			description: description.trim() || undefined,
			projectId: isEpic ? undefined : projectId,
			type,
			parentId: (parentOptions.some((o) => o.id === parentId) && parentId) || null,
			values
		});
		busy = false;
		if (item) {
			onclose();
			ui.open(item.id);
		}
	}
</script>

<dialog bind:this={dialog} class="create" aria-label="New {noun}" onclose={onclose} oncancel={onclose}>
	<form onsubmit={submit}>
		<header>
			<h2>New {noun}</h2>
			<button type="button" class="btn ghost small" aria-label="Close" onclick={onclose}>×</button>
		</header>
		<!-- svelte-ignore a11y_autofocus -->
		<input class="title" bind:value={title} placeholder={isEpic ? 'Epic title' : 'Issue title'} maxlength="255" required autofocus aria-label="Title" />
		<textarea bind:value={description} placeholder="Add a description (Markdown)…" rows="4" aria-label="Description"></textarea>

		<div class="grid">
			{#if isEpic}
				<label
					>Group
					<input class="input" value={board.data.groupLabel} readonly title="Epics are created in the board's group" />
				</label>
			{:else}
				<label
					>Project
					<select class="input" bind:value={projectId} required>
						{#each board.reg.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
			{/if}
			<label
				>Type
				<select class="input" bind:value={type} onchange={typeChanged}>
					{#each board.reg.types as t (t.id)}<option value={t.name}>{t.name}</option>{/each}
				</select>
			</label>
			{#if statusOptions.length}
				<label
					>Status
					<select class="input" bind:value={statusId}>
						<option value="">Default</option>
						{#each statusOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
					</select>
				</label>
			{/if}
			{#if canAssign}
				<label
					>Assignee
					<select class="input" bind:value={assignee}>
						<option value="">Unassigned</option>
						{#if board.reg.currentUserId}<option value={board.reg.currentUserId}>Me</option>{/if}
						{#each board.reg.people.filter((p) => p.id !== board.reg.currentUserId) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</label>
			{/if}
			<label class="wide"
				>{isEpic ? 'Parent epic' : 'Parent'}
				<select class="input" bind:value={parentId}>
					<option value="">No parent</option>
					{#each parentOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
				</select>
			</label>
		</div>

		{#if extras.length}
			<div class="extras">
				<span class="muted">From this view:</span>
				{#each extras as x (x.key)}
					<span class="chip" class:off={!x.applies} title={x.applies ? '' : `${x.name} doesn't apply to ${isEpic ? 'an' : 'a'} ${type}; it won't be set`}>
						{x.name}: {x.label}
						<button type="button" aria-label="Don't set {x.name}" onclick={() => (extra = Object.fromEntries(Object.entries(extra).filter(([k]) => k !== x.key)))}>×</button>
					</span>
				{/each}
			</div>
		{/if}

		<footer>
			<span class="muted">Created in GitLab with your account.</span>
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<button class="btn primary" disabled={busy || !title.trim() || (!isEpic && !projectId)}>{busy ? 'Creating…' : `Create ${noun}`}</button>
		</footer>
	</form>
</dialog>

<style>
	.create {
		width: min(640px, calc(100vw - 24px));
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--text-primary);
		box-shadow: var(--shadow-pop);
	}
	.create::backdrop {
		background: var(--overlay);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px 16px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.title {
		border: 0;
		background: transparent;
		font-size: 19px;
		font-weight: 650;
		outline: none;
		padding: 4px 0;
	}
	textarea {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-1);
		padding: 8px 10px;
		resize: vertical;
		font-size: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
		gap: 8px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.wide {
		grid-column: 1 / -1;
	}
	.extras {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: 12.5px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px 2px 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.chip.off {
		text-decoration: line-through;
		color: var(--text-muted);
	}
	.chip button {
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--text-muted);
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-top: 6px;
		border-top: 1px solid var(--grid);
	}
	footer .muted {
		flex: 1;
		font-size: 12px;
	}
</style>
