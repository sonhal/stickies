<script lang="ts">
	import { page } from '$app/state';
	import ToolPage from '$lib/components/ToolPage.svelte';
</script>

{#key page.params.toolId}
	<ToolPage toolId={page.params.toolId ?? ''} />
{/key}
