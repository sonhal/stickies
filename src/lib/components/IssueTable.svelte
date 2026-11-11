<script lang="ts">
	import { slotVar, type ColorSlot } from '$lib/colors';
	import type { WorkItem } from '$lib/fields/types';

	interface Props {
		caption: string;
		items: WorkItem[];
		xTitle: string;
		yTitle: string;
		slotFor: (item: WorkItem) => ColorSlot;
		epicTitle: (item: WorkItem) => string;
		describe: (item: WorkItem) => { x: string; y: string; status: string; assignees: string };
		isActive: (item: WorkItem) => boolean;
		/** Optional extra column, e.g. "Missing" on the triage list */
		note?: (item: WorkItem) => string;
		noteTitle?: string;
		onselect: (item: WorkItem) => void;
	}

	let { caption, items, xTitle, yTitle, slotFor, epicTitle, describe, isActive, note, noteTitle, onselect }: Props =
		$props();
</script>

<table>
	<caption>{caption} <span class="n">{items.length}</span></caption>
	<thead>
		<tr>
			<th scope="col">Issue</th>
			<th scope="col">Title</th>
			<th scope="col">Status</th>
			<th scope="col">Epic</th>
			<th scope="col">{xTitle}</th>
			<th scope="col">{yTitle}</th>
			<th scope="col">Assignees</th>
			{#if note}<th scope="col">{noteTitle}</th>{/if}
		</tr>
	</thead>
	<tbody>
		{#each items as issue (issue.id)}
			{@const info = describe(issue)}
			<tr class:dim={!isActive(issue)}>
				<td class="ref">
					{#if issue.url}
						<a href={issue.url} target="_blank" rel="noopener noreferrer">{issue.ref}</a>
					{:else}
						{issue.ref}
					{/if}
				</td>
				<td>
					<button class="title" onclick={() => onselect(issue)}>{issue.title}</button>
					{#if issue.description}<p class="desc">{issue.description}</p>{/if}
				</td>
				<td class="status">{info.status}</td>
				<td class="epic">
					<span class="chip" style="background: {slotVar(slotFor(issue))}"></span>
					{epicTitle(issue)}
				</td>
				<td class="num">{info.x}</td>
				<td>{info.y}</td>
				<td>{info.assignees || '—'}</td>
				{#if note}<td class="note">{note(issue)}</td>{/if}
			</tr>
		{:else}
			<tr><td colspan={note ? 8 : 7} class="empty">Nothing here.</td></tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		font-size: 14px;
	}
	caption {
		text-align: left;
		font-weight: 700;
		font-size: 16px;
		padding: 0 0 8px;
	}
	.n {
		color: var(--text-muted);
		font-weight: 500;
		margin-left: 4px;
	}
	th {
		text-align: left;
		font-weight: 600;
		font-size: 12px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 8px 10px;
		border-bottom: 1px solid var(--border);
	}
	td {
		padding: 7px 10px;
		border-bottom: 1px solid var(--grid);
		color: var(--text-secondary);
		vertical-align: top;
	}
	tr:last-child td {
		border-bottom: 0;
	}
	tr.dim {
		opacity: 0.35;
	}
	.ref {
		font-family: var(--mono);
		font-size: 12px;
		white-space: nowrap;
	}
	.title {
		border: 0;
		background: none;
		padding: 0;
		text-align: left;
		color: var(--text-primary);
		cursor: pointer;
	}
	.title:hover {
		text-decoration: underline;
	}
	.desc {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.epic,
	.status {
		white-space: nowrap;
	}
	.chip {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin-right: 6px;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.note {
		color: var(--danger);
		white-space: nowrap;
	}
	.empty {
		color: var(--text-muted);
		text-align: center;
		padding: 16px;
	}
	@media (max-width: 720px) {
		th:nth-child(4),
		td:nth-child(4),
		th:nth-child(7),
		td:nth-child(7) {
			display: none;
		}
	}
</style>
