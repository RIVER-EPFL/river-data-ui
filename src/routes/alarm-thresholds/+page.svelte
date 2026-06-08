<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto(`${base}/alarms?tab=thresholds`, { replaceState: true });
	});
</script>

<svelte:head><title>Alarm Thresholds | River Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
