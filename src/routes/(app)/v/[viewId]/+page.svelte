<script lang="ts">
	import { page } from '$app/state';
	import ViewPage from '$lib/components/ViewPage.svelte';
</script>

{#key page.params.viewId}
	<ViewPage viewId={page.params.viewId ?? null} />
{/key}
