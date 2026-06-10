<script lang="ts">
	import type { Snippet } from 'svelte';

	let { message = '', children }: { message?: string; children?: Snippet } = $props();
</script>

<div class="rounded-md border border-severity-alarm-border bg-severity-alarm-soft px-3 py-2 text-sm text-severity-alarm">
	{#if children}{@render children()}{:else}{message}{/if}
</div>
