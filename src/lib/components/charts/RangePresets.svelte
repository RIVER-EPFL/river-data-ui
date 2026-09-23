<script lang="ts">
	import { RANGE_PRESETS, activePreset, type RangePreset } from '$lib/charts/rangePresets';

	let {
		start,
		end,
		onpick,
		class: klass = 'px-2.5 py-1',
	}: {
		start: number;
		end: number;
		onpick: (preset: RangePreset) => void;
		class?: string;
	} = $props();

	const active = $derived(activePreset(start, end));
</script>

<div class="flex gap-0.5">
	{#each RANGE_PRESETS as preset (preset)}
		<button
			type="button"
			onclick={() => onpick(preset)}
			aria-pressed={active === preset}
			class="{klass} text-xs rounded cursor-pointer border-none {active === preset
				? 'bg-brand-primary text-white'
				: 'bg-brand-bg text-brand-muted hover:text-brand-text'}">{preset}</button
		>
	{/each}
</div>
