<script lang="ts">
	import { base } from '$app/paths';
	import { getCalculationClosure, listTools, type ToolDescriptor } from '$api/service';
	import { toolsDeclaring, valueChangeConsequence, type StoredUsage } from '$lib/constants/consequence';

	// What a new value does, stated before it is saved: which calculations read this constant, and
	// how much of the record was computed from the value standing now, all of which the save
	// recomputes.

	let { name, id }: { name: string; id?: string } = $props();

	let tools = $state<ToolDescriptor[]>([]);
	let stored = $state<StoredUsage | undefined>(undefined);

	$effect(() => {
		listTools()
			.then((t) => (tools = t))
			.catch(() => (tools = []));
	});

	$effect(() => {
		const constantId = id;
		if (!constantId) return;
		getCalculationClosure({ constant_id: constantId })
			.then((c) => (stored = c.stored ?? undefined))
			.catch(() => (stored = undefined));
	});

	const declaring = $derived(toolsDeclaring(tools, name));
	const message = $derived(
		valueChangeConsequence(
			declaring.map((t) => t.label || t.name),
			stored,
		),
	);
</script>

{#if name}
	<div
		class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-sm text-severity-warning mb-4"
	>
		{message}
		{#if stored && stored.visits > 0}
			<a href="{base}/visits" class="underline ml-1">See the visits</a>
		{/if}
	</div>
{/if}
