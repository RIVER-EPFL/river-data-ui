<script lang="ts">
	import type { Frequency } from '$lib/charts/multiSiteSeries';

	let {
		value = $bindable<Frequency>('high'),
		onchange,
	}: {
		value?: Frequency;
		onchange?: () => void;
	} = $props();

	const CHIPS: Array<[Frequency, string]> = [
		['high', 'High'],
		['low', 'Low'],
		['all', 'All'],
	];
</script>

<div class="flex gap-0.5" title="High = continuous field-sensor line · Low = grab/spot samples · All = both">
	{#each CHIPS as [val, label]}
		<button
			onclick={() => { value = val; onchange?.(); }}
			class="px-2 py-1 text-xs rounded cursor-pointer border-none {value === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
		>{label}</button>
	{/each}
</div>
