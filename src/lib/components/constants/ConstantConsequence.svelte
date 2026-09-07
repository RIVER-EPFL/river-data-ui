<script lang="ts">
	import { listTools, type ToolDescriptor } from '$api/service';
	import { toolsDeclaring, valueChangeConsequence } from '$lib/constants/consequence';

	// What a new value does, stated before it is saved: which calculations read this constant, that
	// the save rewrites none of their stored outputs, and where the repair is.

	let { name }: { name: string } = $props();

	let tools = $state<ToolDescriptor[]>([]);

	$effect(() => {
		listTools()
			.then((t) => (tools = t))
			.catch(() => (tools = []));
	});

	const message = $derived(
		valueChangeConsequence(toolsDeclaring(tools, name).map((t) => t.label || t.name))
	);
</script>

{#if name}
	<div
		class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-sm text-severity-warning mb-4"
	>
		{message}
	</div>
{/if}
