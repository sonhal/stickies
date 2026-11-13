<script lang="ts">
	/**
	 * "Are you sure?" for an action that can't be taken back. A modal <dialog> (the page behind is
	 * inert) with role="alertdialog". Focus starts on Cancel, so Enter right after opening does
	 * nothing harmful; Esc and a click outside cancel. Focus goes back where it was afterwards.
	 * While `busy` (the action is running) it can't be cancelled: the result decides when it closes.
	 */
	interface Props {
		heading: string;
		message: string;
		/** A second, quieter paragraph (e.g. what happens to sub-items) */
		note?: string | null;
		confirmLabel: string;
		busyLabel?: string;
		busy?: boolean;
		/** Red confirm button */
		danger?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}
	let { heading, message, note = null, confirmLabel, busyLabel = 'Working…', busy = false, danger = true, onconfirm, oncancel }: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let cancelBtn: HTMLButtonElement | undefined = $state();
	const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
	const uid = Math.random().toString(36).slice(2, 8);

	$effect(() => {
		dialog?.showModal();
		cancelBtn?.focus();
		// The opener can be gone by now (the deleted item's panel): then the browser's default is fine.
		return () => {
			if (opener?.isConnected) opener.focus();
		};
	});

	function cancel() {
		if (!busy) oncancel();
	}
</script>

<!-- A click on the backdrop lands on the <dialog> itself; clicks inside land on .box. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	class="confirm"
	role="alertdialog"
	aria-modal="true"
	aria-labelledby="confirm-h-{uid}"
	aria-describedby="confirm-m-{uid}"
	oncancel={(e) => {
		// Esc: closed by us, not by the browser, so the parent's state stays the one truth.
		e.preventDefault();
		cancel();
	}}
	onclick={(e) => {
		if (e.target === dialog) cancel();
	}}
>
	<div class="box">
		<h2 id="confirm-h-{uid}">{heading}</h2>
		<div id="confirm-m-{uid}">
			<p>{message}</p>
			{#if note}<p class="note">{note}</p>{/if}
		</div>
		<footer>
			<button type="button" class="btn" bind:this={cancelBtn} onclick={cancel} disabled={busy}>Cancel</button>
			<button type="button" class="btn" class:danger class:solid={danger} class:primary={!danger} onclick={onconfirm} disabled={busy}>
				{busy ? busyLabel : confirmLabel}
			</button>
		</footer>
	</div>
</dialog>

<style>
	.confirm {
		width: min(440px, calc(100vw - 24px));
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--text-primary);
		box-shadow: var(--shadow-pop);
	}
	.confirm::backdrop {
		background: var(--overlay);
	}
	.box {
		padding: 16px 18px 14px;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 15px;
	}
	p {
		margin: 0 0 8px;
		font-size: 13.5px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.note {
		color: var(--text-secondary);
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 14px;
	}
</style>
