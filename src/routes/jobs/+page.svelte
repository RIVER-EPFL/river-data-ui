<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Reprocessing jobs now live in the unified Logs page.
	onMount(() => {
		goto(`${base}/logs?tab=jobs`, { replaceState: true });
	});
</script>

<svelte:head><title>Jobs | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
