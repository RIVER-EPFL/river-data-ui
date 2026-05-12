<script lang="ts">
	let {
		tabs,
		active = $bindable(0),
	}: {
		tabs: string[];
		active: number;
	} = $props();
</script>

<div class="border-b border-brand-divider flex">
	{#each tabs as tab, i}
		<button
			class="px-4 py-2 text-sm font-medium border-b-2 transition-colors cursor-pointer bg-transparent {active === i
				? 'border-brand-primary text-brand-primary font-semibold'
				: 'border-transparent text-brand-muted hover:text-brand-text hover:border-brand-divider'}"
			onclick={() => (active = i)}
		>
			{tab}
		</button>
	{/each}
</div>
