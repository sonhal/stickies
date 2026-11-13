<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { appliesTo, closedKind } from '$lib/fields/registry';
	import type { FieldDef, WorkItem } from '$lib/fields/types';
	import { slotVar } from '$lib/colors';
	import StatusIcon from './ui/StatusIcon.svelte';

	interface Props {
		item: WorkItem;
		onclose?: () => void;
		onopen?: (id: string) => void;
		/** Renders a field's value (read-only text by default; the editor in Phase 4) */
		value?: Snippet<[FieldDef, WorkItem]>;
		/** Title area (an inline editor in Phase 4) */
		title?: Snippet<[WorkItem]>;
		/** Description area: gets the item and the read-only view, e.g. to wrap it with an editor */
		description?: Snippet<[WorkItem, Snippet]>;
		/**
		 * Item actions drawn at the foot of the panel (e.g. Delete…). Not in the header: at 30vw the
		 * header is already full with the reference and "Open in GitLab".
		 */
		actions?: Snippet<[WorkItem]>;
		compact?: boolean;
		/**
		 * Full-page layout (/issue/<id>), like Linear's issue view: title, description and sub-issues
		 * in a wide column, the fields in a "Properties" column on the right. No header: the page
		 * draws its own bar.
		 */
		page?: boolean;
		/** Parents and children become links to these paths (the full page) instead of onopen */
		hrefFor?: (id: string) => string;
		/** Page only: a control next to the "Sub-issues" heading (e.g. "+ Add sub-issue") */
		childAction?: Snippet<[WorkItem]>;
		/** Panel only: link to the item's full page, shown as an expand button in the header */
		pageHref?: string;
		onpage?: () => void;
		/** Page only: the bar at the top of the main column (breadcrumb, menu) */
		bar?: Snippet<[WorkItem]>;
		/** Page only: icon buttons in the Properties header (copy link, copy ID) */
		propsActions?: Snippet<[WorkItem]>;
		/** Page only: show the Properties column (it can be hidden, as in Linear) */
		showProps?: boolean;
	}

	let { item, onclose, onopen, value, title, description, actions, compact = false, page = false, hrefFor, childAction, pageHref, onpage, bar, propsActions, showProps = true }: Props = $props();
	const board = getBoard();

	/** Every field that applies to this item's type, plus any other field it has a value for. */
	const fields = $derived(
		board.reg.fields.filter(
			(f) =>
				!['native:type', 'native:createdAt', 'native:updatedAt'].includes(f.key) &&
				(appliesTo(f, item.type) || item.values[f.key] !== undefined)
		)
	);

	const crumbs = $derived.by(() => {
		const out: WorkItem[] = [];
		let cur = item.parentId ? board.byId.get(item.parentId) : undefined;
		for (let d = 0; cur && d < 6; d++) {
			out.unshift(cur);
			cur = cur.parentId ? board.byId.get(cur.parentId) : undefined;
		}
		return out;
	});
	const children = $derived(board.items.filter((i) => i.parentId === item.id));
	const childrenDone = $derived(children.filter((c) => closedKind(board.reg, c)).length);
	/** GitLab counts children the board doesn't hold (closed long ago, or not visible to you) */
	const childrenElsewhere = $derived(item.progress ? Math.max(0, item.progress.total - children.length) : 0);
	const paragraphs = $derived(item.description ? item.description.split(/\n{2,}/) : []);
	const closed = $derived(closedKind(board.reg, item));
	const updatedLocally = $derived(item.updatedAt);
</script>

{#snippet crumbsBlock()}
	{#if crumbs.length}
		<nav class="crumbs" aria-label="Parents">
			{#each crumbs as c (c.id)}
				{#if hrefFor}
					<a class="crumb" href={hrefFor(c.id)}>{c.title}</a><span aria-hidden="true">›</span>
				{:else}
					<button type="button" class="crumb" onclick={() => onopen?.(c.id)}>{c.title}</button><span aria-hidden="true">›</span>
				{/if}
			{/each}
		</nav>
	{:else if item.parentId}
		<p class="crumbs muted">Parent: {board.text(item, 'native:parent') || 'not on the board'}</p>
	{/if}
{/snippet}

{#snippet fieldsBlock()}
	<dl class="fields">
		{#each fields as f (f.key)}
			<div class="f">
				<dt title={f.rawType ? `Custom field of type ${f.rawType} (shown read-only)` : f.name}>{f.name}</dt>
				<dd>
					{#if value}{@render value(f, item)}{:else}{board.text(item, f.key) || '—'}{/if}
				</dd>
			</div>
		{/each}
	</dl>
{/snippet}

{#snippet progressBlock()}
	{#if item.progress && item.progress.total > 0}
		{@const pct = Math.round((item.progress.closed / item.progress.total) * 100)}
		<div class="progress" title="{item.progress.closed} of {item.progress.total} child items closed (from GitLab)">
			<div class="bar"><span style="width: {pct}%"></span></div>
			<span>{pct}% · {item.progress.closed}/{item.progress.total}</span>
		</div>
	{/if}
{/snippet}

{#snippet readDescription()}
	<div class="desc">
		{#each paragraphs as p, i (i)}
			<p>{p}</p>
		{:else}
			<p class="muted"><em>No description.</em></p>
		{/each}
		{#if item.descriptionTruncated && item.url}
			<a href={item.url} target="_blank" rel="noopener noreferrer">Read the rest in GitLab ↗</a>
		{/if}
	</div>
{/snippet}

{#snippet childrenBlock()}
	{#if page && !children.length}
		<!-- Like Linear: no empty heading, just a quiet "+ Add sub-issues" under the description -->
		<div class="add-sub">
			{@render childAction?.(item)}
			{#if childrenElsewhere}
				<p class="elsewhere muted">{childrenElsewhere} sub-item{childrenElsewhere === 1 ? '' : 's'} in GitLab that aren't on the board (closed a while ago, or not visible to you).</p>
			{/if}
		</div>
	{:else if children.length}
		<section class="children">
			<h3>
				Child items
				<span class="muted">{#if page && children.length}{childrenDone}/{children.length}{:else}{children.length}{/if}</span>
				{#if page && childAction}<span class="spacer"></span>{@render childAction(item)}{/if}
			</h3>
			{#each children as c (c.id)}
				{#if hrefFor}
					<a class="child" href={hrefFor(c.id)}>
						<StatusIcon status={board.status(c)} size={12} />
						<span class="cref">{c.ref.replace(/^.*\//, '')}</span>
						<span class="ctitle">{c.title}</span>
					</a>
				{:else}
					<button type="button" class="child" onclick={() => onopen?.(c.id)}>
						<StatusIcon status={board.status(c)} size={12} />
						<span class="cref">{c.ref.replace(/^.*\//, '')}</span>
						<span class="ctitle">{c.title}</span>
					</button>
				{/if}
			{/each}
			{#if page && childrenElsewhere}
				<p class="elsewhere muted">
					+ {childrenElsewhere} more in GitLab that aren't on the board (closed a while ago, or not visible to you).
				</p>
			{/if}
		</section>
	{/if}
{/snippet}

{#snippet updatedBlock()}
	<p class="updated muted">Updated {updatedLocally.slice(0, 16).replace('T', ' ')} UTC</p>
{/snippet}

{#if page}
	<!-- Full page (/issue/<id>), laid out like Linear's issue view: the work on the left, properties on the right -->
	<article class="page" class:noprops={!showProps} aria-label="Issue: {item.title}">
		<div class="main-col">
			{#if bar}<div class="pbar">{@render bar(item)}</div>{/if}
			<div class="main">
				{@render crumbsBlock()}
				{#if title}{@render title(item)}{:else}<h1 class="ptitle">{item.title}</h1>{/if}
				{#if description}{@render description(item, readDescription)}{:else}{@render readDescription()}{/if}
				{@render childrenBlock()}
				{#if actions}{@render actions(item)}{/if}
			</div>
		</div>
		{#if showProps}
			<aside class="props" aria-label="Properties">
				<div class="props-head">
					<h2 class="props-h">Properties</h2>
					<span class="spacer"></span>
					{@render propsActions?.(item)}
				</div>
				<div class="props-body">
					{@render fieldsBlock()}
					{@render progressBlock()}
					{@render updatedBlock()}
				</div>
			</aside>
		{/if}
	</article>
{:else}
	<article class="panel" class:compact aria-label="Issue details: {item.title}">
		<header>
			<span class="epic" style="background: {slotVar(board.colors.slotFor(item))}"></span>
			<span class="ref">{item.ref}</span>
			<span class="type">{item.type}</span>
			{#if closed}<span class="closed">{closed === 'done' ? 'Completed' : 'Canceled'}</span>{/if}
			<span class="spacer"></span>
			{#if pageHref}
				<a class="btn ghost small x" href={pageHref} onclick={onpage} title="Open as page" aria-label="Open as page">⤢</a>
			{/if}
			{#if item.url}
				<a class="btn ghost small" href={item.url} target="_blank" rel="noopener noreferrer">Open in GitLab ↗</a>
			{/if}
			{#if onclose}<button type="button" class="btn ghost small x" onclick={onclose} aria-label="Close panel (Esc)">×</button>{/if}
		</header>
		{@render crumbsBlock()}
		{#if title}{@render title(item)}{:else}<h2>{item.title}</h2>{/if}
		{@render fieldsBlock()}
		{@render progressBlock()}
		{#if description}{@render description(item, readDescription)}{:else}{@render readDescription()}{/if}
		{@render childrenBlock()}
		{@render updatedBlock()}
		{#if actions}{@render actions(item)}{/if}
	</article>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px 18px;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.epic {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.ref {
		font-family: var(--mono);
	}
	.type,
	.closed {
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
	}
	.closed {
		color: var(--ok);
	}
	.spacer {
		flex: 1;
	}
	.x {
		font-size: 18px;
	}
	.crumbs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
		font-size: 12.5px;
		color: var(--text-muted);
		margin: 0;
	}
	.crumb {
		border: 0;
		background: none;
		padding: 0;
		color: var(--text-secondary);
		cursor: pointer;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crumb:hover {
		text-decoration: underline;
	}
	h2 {
		margin: 0;
		font-size: 19px;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.fields {
		display: grid;
		grid-template-columns: minmax(90px, max-content) minmax(0, 1fr);
		gap: 2px 14px;
		margin: 4px 0 0;
		font-size: 13px;
	}
	.f {
		display: contents;
	}
	dt {
		color: var(--text-muted);
		padding: 5px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	dd {
		margin: 0;
		min-width: 0;
		padding: 1px 0;
		display: flex;
		align-items: center;
		min-height: 30px;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--grid);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	.desc {
		border-top: 1px solid var(--grid);
		padding-top: 10px;
		font-size: 14px;
		line-height: 1.55;
	}
	.desc p {
		margin: 0 0 0.7em;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.children h3 {
		font-size: 13px;
		margin: 4px 0 6px;
	}
	.child {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 6px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}
	.child:hover {
		background: var(--hover);
	}
	.cref {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.ctitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.updated {
		font-size: 11.5px;
		margin: 0;
	}
	.compact {
		padding: 0;
	}

	/* ---- Full page (like Linear's issue view) ---- */
	.page {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		min-height: 0;
		flex: 1;
	}
	.page.noprops {
		grid-template-columns: minmax(0, 1fr);
	}
	.main-col {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* The breadcrumb bar and the Properties header line up, both with a rule under them */
	.pbar,
	.props-head {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 4px 14px;
		border-bottom: 1px solid var(--grid);
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: 14px;
		width: 100%;
		max-width: 820px;
		margin: 0 auto;
		padding: 28px 40px 48px;
		min-width: 0;
	}
	.ptitle {
		margin: 0;
		font-size: 26px;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}
	.page .desc {
		border-top: 0;
		padding-top: 0;
		font-size: 15px;
	}
	.page .children {
		border-top: 1px solid var(--grid);
		padding-top: 14px;
	}
	.children h3 {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.children h3 .spacer {
		flex: 1;
	}
	.add-sub {
		margin-left: -7px;
	}
	.add-sub .elsewhere {
		margin-left: 7px;
	}
	.elsewhere {
		font-size: 12.5px;
		margin: 6px 6px 0;
	}
	a.child {
		color: inherit;
		text-decoration: none;
	}
	a.crumb {
		text-decoration: none;
	}
	.props {
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--border);
		background: var(--surface-1);
		min-width: 0;
	}
	.props-head {
		padding-left: 18px;
	}
	.props-h {
		margin: 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
	}
	.props-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px 18px 32px;
	}
	/* Stacked, as in Linear: a small heading over each value instead of a two-column table */
	.props .fields {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
	}
	.props .f {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.props dt {
		padding: 0;
		font-size: 12px;
	}
	.props dd {
		min-height: 26px;
	}
	@media (max-width: 900px) {
		.page {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Narrow: the title and description first, properties below, as on a phone in Linear */
		.props {
			border-left: 0;
			border-top: 1px solid var(--border);
		}
		.main {
			padding: 20px 16px 40px;
		}
	}
</style>
