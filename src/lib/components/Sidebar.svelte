<script lang="ts">
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { getViews } from '$lib/client/views-context';
	import { getTools } from '$lib/client/tools-context';
	import { toolType } from '$lib/prioritization/tools';
	import { closedKind } from '$lib/fields/registry';
	import { slotVar } from '$lib/colors';
	import { epicSlug, isEpic } from '$lib/query/epics';
	import { settings } from '$lib/views.config';
	import type { Viewer } from '../../routes/+layout.server';

	interface Props {
		viewer: Viewer;
		kioskViews: string[] | null;
		onnavigate?: () => void;
	}
	let { viewer, kioskViews, onnavigate }: Props = $props();
	const board = getBoard();
	const ui = getUi();
	const views = getViews();
	const tools = getTools();

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const shownViews = $derived(kioskViews ? views.config : views.all);

	const teams = $derived(
		board.reg.projects
			.map((p) => ({ p, open: board.items.filter((i) => i.projectId === p.id && !closedKind(board.reg, i)).length }))
			.filter((t) => t.open > 0)
	);
	const epics = $derived(
		board.items
			.filter((i) => isEpic(i) && !closedKind(board.reg, i))
			.sort((a, b) => a.title.localeCompare(b.title))
			.slice(0, 12)
	);
	const path = $derived(page.url.pathname);
	const active = (href: string) => path === href || (href !== '/' && path.startsWith(href + '/'));
	// "/" shows the home page: a tool on a kiosk that lists one first, otherwise the first view
	const homeTool = tools.home?.kind === 'tool' ? tools.home.id : null;
	const firstView = $derived(homeTool ? null : shownViews[0]?.id);
</script>

<nav class="side" aria-label="Board navigation">
	<div class="brand">
		<span class="logo" aria-hidden="true">◧</span>
		<span class="name">{settings.title}</span>
		<span class="group" title={board.data.groupLabel}>{board.data.groupLabel}</span>
	</div>

	<button type="button" class="palette" onclick={() => (ui.paletteOpen = true)}>
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
			><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg
		>
		<span>Search or jump to…</span>
		<kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
	</button>

	{#if !ui.readOnly}
		<button type="button" class="new" onclick={() => (ui.createOpen = { ...ui.createDefaults })}>
			<span aria-hidden="true">+</span> New issue <kbd>C</kbd>
		</button>
	{/if}

	<div class="section">
		<h2>Views</h2>
		<ul>
			{#each shownViews as v, i (v.id)}
				{@const href = i === 0 && !kioskViews ? '/' : `/v/${v.id}`}
				<li>
					<a
						href="/v/{v.id}"
						class:active={active(`/v/${v.id}`) || (path === '/' && v.id === firstView)}
						onclick={onnavigate}
						data-href={href}
					>
						<span class="ic" aria-hidden="true">{v.layout === 'board' ? '▥' : '☰'}</span>
						<span class="lbl">{v.name}</span>
						{#if views.isPersonal(v.id)}<span class="mine" title="Saved in this browser">•</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
		{#if !kioskViews && views.loaded && !views.writable}
			<p class="note">Views can't be saved in this browser (storage is blocked or full).</p>
		{/if}
	</div>

	{#if tools.list.length}
		<div class="section">
			<h2>Prioritization</h2>
			<ul>
				{#each tools.list as t (t.id)}
					{@const type = toolType(t)}
					<li>
						<a
							href="/p/{t.id}"
							class="two-line"
							class:active={active(`/p/${t.id}`) || (path === '/' && t.id === homeTool)}
							onclick={onnavigate}
							title="{type.name}: {type.description}"
						>
							<span class="ic" aria-hidden="true">{type.icon}</span>
							<span class="tool">
								<span class="lbl">{t.name}</span>
								<span class="kind">{type.name}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if teams.length}
		<div class="section">
			<h2>Teams</h2>
			<ul>
				{#each teams as t (t.p.id)}
					<li>
						<a href="/team/{t.p.fullPath}" class:active={active(`/team/${t.p.fullPath}`)} onclick={onnavigate}>
							<span class="ic" aria-hidden="true">#</span>
							<span class="lbl">{t.p.name}</span>
							<span class="n">{t.open}</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<div class="section">
		<h2><a href="/epics" class:active={path === '/epics'} onclick={onnavigate}>Epics</a></h2>
		<ul>
			{#each epics as e (e.id)}
				<li>
					<a href="/epics/{epicSlug(e.id)}" class:active={active(`/epics/${epicSlug(e.id)}`)} onclick={onnavigate}>
						<span class="dot" style="background: {slotVar(board.colors.slotFor(e))}" aria-hidden="true"></span>
						<span class="lbl">{e.title}</span>
						{#if e.progress?.total}<span class="n">{Math.round((e.progress.closed / e.progress.total) * 100)}%</span>{/if}
					</a>
				</li>
			{:else}
				<li class="note">No open epics</li>
			{/each}
		</ul>
	</div>

	<div class="foot">
		{#if viewer?.kind === 'user'}
			<span class="who" title="@{viewer.username}">{viewer.name}</span>
			<!-- Plain form POST: works without JS and is covered by SvelteKit's CSRF origin check. -->
			<form method="POST" action="/auth/logout"><button class="btn ghost small">Sign out</button></form>
		{:else if viewer?.kind === 'kiosk'}
			<span class="who" title="Signed in as the kiosk screen (read-only service token)">Kiosk · read-only</span>
		{/if}
	</div>
</nav>

<style>
	li a.two-line {
		height: auto;
		min-height: 28px;
		padding-top: 4px;
		padding-bottom: 4px;
	}
	/* Prioritization entries: name, and the tool type on a second line (the sidebar is too narrow for both) */
	.tool {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.25;
	}
	.kind {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 6px;
		height: 100%;
		padding: 12px 10px;
		overflow-y: auto;
		background: var(--surface-1);
		border-right: 1px solid var(--border);
		font-size: 13.5px;
	}
	.brand {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 2px 8px 8px;
		min-width: 0;
	}
	.logo {
		color: var(--accent);
		font-size: 16px;
	}
	.name {
		font-weight: 700;
	}
	.group {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.palette,
	.new {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}
	.palette span {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.new {
		color: var(--text-primary);
		border-color: transparent;
		background: transparent;
	}
	.new kbd {
		margin-left: auto;
	}
	.new:hover,
	.palette:hover {
		background: var(--hover);
	}
	.section {
		margin-top: 8px;
	}
	h2 {
		margin: 0;
		padding: 4px 8px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.03em;
	}
	h2 a {
		color: inherit;
		text-decoration: none;
	}
	h2 a:hover,
	h2 a.active {
		color: var(--text-primary);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li a {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 28px;
		padding: 0 8px;
		border-radius: 6px;
		color: var(--text-secondary);
		text-decoration: none;
	}
	li a:hover {
		background: var(--hover);
		color: var(--text-primary);
	}
	li a.active {
		background: var(--selected);
		color: var(--text-primary);
		font-weight: 550;
	}
	.ic {
		width: 14px;
		text-align: center;
		color: var(--text-muted);
		flex: none;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin: 0 2.5px;
		flex: none;
	}
	.lbl {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		font-size: 12px;
		color: var(--text-muted);
	}
	.mine {
		color: var(--accent);
	}
	.note {
		font-size: 12px;
		color: var(--text-muted);
		padding: 4px 8px;
		margin: 0;
	}
	.foot {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 6px 0;
		border-top: 1px solid var(--grid);
	}
	.who {
		flex: 1;
		font-size: 12.5px;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
