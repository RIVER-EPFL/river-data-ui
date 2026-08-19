<script lang="ts">
	import type { Constant } from '$api/crud';
	import Button from '$components/ui/Button.svelte';

	let {
		constants = $bindable(),
		catalog = [],
	}: { constants: string[]; catalog?: Constant[] } = $props();

	const field =
		'w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs font-mono';
	// A field the server refuses to save empty reads as needing attention until it is filled.
	const missing = 'border-severity-warning-border bg-severity-warning-soft';

	const byName = $derived(new Map(catalog.map((c) => [c.name, c])));
	const unused = $derived(catalog.filter((c) => !constants.includes(c.name)));
</script>

<div class="rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex items-center justify-between px-3 py-2 border-b border-brand-divider">
		<h5 class="text-sm font-semibold">Constants</h5>
		<Button size="sm" onclick={() => (constants = [...constants, ''])}>Add constant</Button>
	</div>
	<div class="p-3 space-y-2">
		{#if constants.length === 0}
			<p class="text-sm text-brand-muted">None declared.</p>
		{/if}
		{#each constants as name, i}
			{@const known = byName.get(name)}
			<div class="flex items-center gap-2">
				<input
					type="text"
					aria-label="Constant name"
					list="tool-constant-names"
					bind:value={constants[i]}
					class="{field} {name.trim() ? '' : missing}"
				/>
				<span class="text-xs text-brand-muted whitespace-nowrap min-w-40">
					{#if known}
						{known.value}{#if known.units}<span> {known.units}</span>{/if}
					{:else if name.trim()}
						Not in the constants table
					{/if}
				</span>
				<Button
					size="sm"
					variant="ghost"
					title="Remove constant"
					onclick={() => (constants = constants.filter((_, j) => j !== i))}>Remove</Button
				>
			</div>
		{/each}
		{#if unused.length > 0}
			<div class="pt-1">
				<p class="text-xs text-brand-muted mb-1">In the constants table:</p>
				<div class="flex flex-wrap gap-1">
					{#each unused.slice(0, 24) as c}
						<Button size="sm" onclick={() => (constants = [...constants, c.name])}>{c.name}</Button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<datalist id="tool-constant-names">
	{#each catalog as c}
		<option value={c.name}></option>
	{/each}
</datalist>
