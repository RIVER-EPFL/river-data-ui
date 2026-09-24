<script lang="ts">
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// A rollback names what it puts back before it runs: one line per value, from what it holds
	// now to what it held before.
	let {
		open = $bindable(false),
		title,
		lines,
		note = null,
		loading = false,
		busy = false,
		error = '',
		onconfirm,
	}: {
		open: boolean;
		title: string;
		lines: string[];
		note?: string | null;
		loading?: boolean;
		busy?: boolean;
		error?: string;
		onconfirm: () => void;
	} = $props();
</script>

<Dialog bind:open {title} maxWidth="sm">
	{#snippet children()}
		<div class="space-y-2 text-sm">
			{#if loading}
				<p class="text-brand-muted">Reading what it restores…</p>
			{:else if lines.length === 0}
				<p class="text-brand-muted">Nothing is left to roll back: every value here was already put back.</p>
			{:else}
				<p>{lines.length} value{lines.length === 1 ? '' : 's'} will be put back:</p>
				<ul class="max-h-64 space-y-0.5 overflow-y-auto font-mono text-xs" data-rollback-lines>
					{#each lines as line, i (i)}
						<li>{line}</li>
					{/each}
				</ul>
				<p class="text-brand-muted">The rollback is recorded on each reading's history.</p>
			{/if}
			{#if note}
				<p class="text-brand-muted">{note}</p>
			{/if}
			{#if error}
				<ErrorNotice message={error} />
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="danger" loading={busy} disabled={loading || lines.length === 0} onclick={onconfirm}>
			{busy ? 'Rolling back…' : 'Roll back'}
		</Button>
	{/snippet}
</Dialog>
