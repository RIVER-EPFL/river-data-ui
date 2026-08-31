<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// API audit + sync events now live in the System page's Logs tab.
	onMount(() => {
		goto(`${base}/system?tab=logs`, { replaceState: true });
	});
</script>

<svelte:head><title>System | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
