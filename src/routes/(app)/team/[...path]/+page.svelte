<script lang="ts">
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import ViewPage from '$lib/components/ViewPage.svelte';

	// Team = project: the current (or first) view, scoped to this project. ?view=<id> picks another view.
	const board = getBoard();
	const path = $derived(page.params.path ?? '');
	const project = $derived(board.reg.projects.find((p) => p.fullPath === path));
</script>

{#key path}
	<ViewPage
		viewId={page.url.searchParams.get('view') ?? 'team'}
		scope={{ projects: [path] }}
		heading={project?.name ?? path}
		subheading={path}
	/>
{/key}
