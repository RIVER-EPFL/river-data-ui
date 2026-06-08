<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// API audit + sync events now live in the unified Logs page (admin-gated tabs).
	onMount(() => {
		goto(`${base}/logs?tab=audit`, { replaceState: true });
	});
</script>

<svelte:head><title>Logs | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
