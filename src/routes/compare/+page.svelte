<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Multi-site time-series comparison now lives on the Explore page.
	onMount(() => {
		goto(`${base}/explore?tab=timeseries`, { replaceState: true });
	});
</script>

<svelte:head><title>Time Series | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
