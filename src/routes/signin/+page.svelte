<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const loginHref = $derived(`/auth/login?returnTo=${encodeURIComponent(data.returnTo)}`);
</script>

<svelte:head>
	<title>Sign in · Standup matrix</title>
</svelte:head>

<main>
	<section class="card">
		<h1>Standup matrix</h1>
		{#if data.signedOut}
			<p class="info">You're signed out.</p>
		{/if}
		{#if data.error}
			<p class="error" role="alert">{data.error}</p>
		{/if}

		{#if data.oauthEnabled}
			<p>Sign in with your GitLab account. The board shows the issues you can see in GitLab, nothing more.</p>
			<!-- A full page navigation (not a client-side route) so the redirect to GitLab works. -->
			<a class="btn" href={loginHref} data-sveltekit-reload>Sign in with GitLab</a>
			<p class="muted">You'll be sent to {data.gitlabHost}. The board asks for the <code>api</code> scope so you can edit issues from it. Your session lasts at most {data.sessionDays} day{data.sessionDays === 1 ? '' : 's'}.</p>
		{:else}
			<p>This board is set up for a kiosk screen only. Ask whoever runs it for the kiosk link.</p>
		{/if}
	</section>
</main>

<style>
	main {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 16px;
	}
	.card {
		max-width: 420px;
		width: 100%;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 28px 28px 22px;
	}
	h1 {
		margin: 0 0 12px;
		font-size: 22px;
	}
	p {
		color: var(--text-secondary);
	}
	.btn {
		display: inline-block;
		margin: 6px 0 4px;
		padding: 10px 16px;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}
	.muted {
		font-size: 13px;
		color: var(--text-muted);
	}
	.error {
		color: var(--danger);
	}
	.info {
		color: var(--text-primary);
	}
</style>
