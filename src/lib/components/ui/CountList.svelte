<script lang="ts">
	let {
		rows,
	}: {
		rows: { label: string; value: string | number }[];
	} = $props();
</script>

<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
	{#each rows as row (row.label)}
		<dt class="text-brand-muted whitespace-nowrap">{row.label}</dt>
		<dd class="m-0 font-mono text-brand-text text-right">{row.value}</dd>
	{/each}
</dl>
