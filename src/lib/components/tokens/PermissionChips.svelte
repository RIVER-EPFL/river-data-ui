<script lang="ts">
	import type { TokenPermissions } from '$api/crud';

	let { permissions }: { permissions: TokenPermissions | undefined } = $props();

	// Group the four booleans into read/write resource lists so each access level is one colored chip
	// (read = brand blue, write = brand amber) instead of four comma-separated phrases.
	const reads = $derived(
		[
			permissions?.read_data ? 'data' : null,
			permissions?.read_metadata ? 'metadata' : null,
		].filter(Boolean) as string[],
	);
	const writes = $derived(
		[
			permissions?.write_data ? 'data' : null,
			permissions?.write_metadata ? 'metadata' : null,
		].filter(Boolean) as string[],
	);

	const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
</script>

<div class="flex flex-wrap gap-1.5">
	{#if reads.length}
		<span class="{chip} bg-brand-primary/10 text-brand-primary">Read: {reads.join(', ')}</span>
	{/if}
	{#if writes.length}
		<span class="{chip} bg-brand-accent/10 text-brand-accent-dark">Write: {writes.join(', ')}</span>
	{/if}
	{#if !reads.length && !writes.length}
		<span class="{chip} bg-brand-bg text-brand-muted">none</span>
	{/if}
</div>
