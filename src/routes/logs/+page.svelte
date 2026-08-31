<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	// Logs merged into the unified System page (Logs / Jobs tabs). Preserve a jobs deep-link;
	// audit / sync / anything else lands on the Logs tab.
	onMount(() => {
		const tab = page.url.searchParams.get('tab') === 'jobs' ? 'jobs' : 'logs';
		goto(`${base}/system?tab=${tab}`, { replaceState: true });
	});
</script>

<svelte:head><title>System | RIVER Data</title></svelte:head>

<p class="text-brand-muted">Redirecting…</p>
