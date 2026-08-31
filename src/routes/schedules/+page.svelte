<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';

	// Schedules merged into the unified System page (Schedules tab).
	onMount(() => {
		goto(`${base}/system?tab=schedules`, { replaceState: true });
	});
</script>

<svelte:head><title>System | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
