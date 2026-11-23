<script lang="ts">
	import { onMount } from 'svelte';
	import { renderMarkdown } from '$lib/client/markdown';

	/**
	 * GitLab Markdown (comments, descriptions) as sanitized HTML. See src/lib/client/markdown.ts.
	 *
	 * DOMPurify needs the DOM, so the HTML is only built in the browser. Until then (server render,
	 * hydration) it shows `fallback` as plain text, or the Markdown itself: Svelte doesn't repair
	 * an {@html} block that differs between server and browser, so the two must never be mixed up.
	 */
	let {
		text,
		url,
		fallback = null,
		class: cls = ''
	}: {
		text: string;
		/** The item's GitLab address: relative links resolve against it */
		url: string | null;
		/** Plain text to show before the browser has rendered the Markdown */
		fallback?: string | null;
		class?: string;
	} = $props();

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const plain = $derived((fallback ?? text).split(/\n{2,}/));
</script>

{#if mounted}
	<!-- The board's only {@html}: renderMarkdown sanitizes with DOMPurify (allowlisted tags, safe links only) -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="md {cls}">{@html renderMarkdown(text, url)}</div>
{:else}
	<div class="md plain {cls}">
		{#each plain as p, i (i)}<p>{p}</p>{/each}
	</div>
{/if}

<style>
	.md {
		overflow-wrap: anywhere;
	}
	.plain p {
		white-space: pre-line;
	}
	.md :global(:is(p, ul, ol, pre, blockquote, table, details)) {
		margin: 0 0 0.6em;
	}
	.md :global(:last-child) {
		margin-bottom: 0;
	}
	.md :global(:is(ul, ol)) {
		padding-left: 1.4em;
	}
	.md :global(li > :is(ul, ol)) {
		margin-bottom: 0;
	}
	.md :global(:is(h1, h2, h3, h4, h5, h6)) {
		margin: 0.9em 0 0.35em;
		line-height: 1.3;
		font-weight: 600;
	}
	.md :global(:is(h1, h2, h3, h4, h5, h6):first-child) {
		margin-top: 0;
	}
	.md :global(h1) {
		font-size: 1.3em;
	}
	.md :global(h2) {
		font-size: 1.15em;
	}
	.md :global(:is(h3, h4, h5, h6)) {
		font-size: 1em;
	}
	.md :global(hr) {
		border: 0;
		border-top: 1px solid var(--grid);
		margin: 0.9em 0;
	}
	.md :global(code) {
		font-family: var(--mono);
		font-size: 0.9em;
		background: var(--surface-2);
		border: 1px solid var(--grid);
		border-radius: 4px;
		padding: 0 3px;
	}
	.md :global(pre) {
		background: var(--surface-2);
		border: 1px solid var(--grid);
		border-radius: 6px;
		padding: 8px 10px;
		overflow-x: auto;
		overflow-wrap: normal;
	}
	.md :global(pre code) {
		border: 0;
		padding: 0;
		background: none;
		white-space: pre;
	}
	.md :global(blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 10px;
		color: var(--text-secondary);
	}
	.md :global(table) {
		border-collapse: collapse;
		display: block;
		max-width: 100%;
		overflow-x: auto;
		overflow-wrap: normal;
	}
	.md :global(:is(th, td)) {
		border: 1px solid var(--border);
		padding: 3px 8px;
		text-align: left;
	}
	.md :global(th) {
		background: var(--surface-2);
		font-weight: 600;
	}
	.md :global(:is(th, td)[align='center']) {
		text-align: center;
	}
	.md :global(:is(th, td)[align='right']) {
		text-align: right;
	}
	/* GFM task lists: a bulleted one shows the checkbox in place of the bullet, a numbered one keeps its numbers */
	.md :global(ul > li:has(> input[type='checkbox'])) {
		list-style: none;
	}
	.md :global(ul > li > input[type='checkbox']) {
		margin: 0 0.4em 0 -1.3em;
		vertical-align: -1px;
	}
	.md :global(summary) {
		cursor: pointer;
	}
	.md :global(img) {
		max-width: 100%;
	}
</style>
