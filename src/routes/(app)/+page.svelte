<script lang="ts">
	import { getTools } from '$lib/client/tools-context';
	import ToolPage from '$lib/components/ToolPage.svelte';
	import ViewPage from '$lib/components/ViewPage.svelte';

	// "/" is the first view, or on a kiosk whatever KIOSK_VIEWS lists first (a view or a tool).
	const home = getTools().home;
</script>

{#if home?.kind === 'tool'}
	<ToolPage toolId={home.id} />
{:else}
	<ViewPage viewId={home?.kind === 'view' ? home.id : null} />
{/if}
