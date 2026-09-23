<script lang="ts">
	import type { Frequency } from '$lib/charts/multiSiteSeries';
	import { heldChoice, offeredCadences } from '$lib/sites/cadence';

	let {
		value = $bindable<Frequency>('high'),
		available = { high: true, low: true },
		onchange,
	}: {
		value?: Frequency;
		/** Which cadences the data actually holds. Only those are offered, and All only with both. */
		available?: { high: boolean; low: boolean };
		onchange?: () => void;
	} = $props();

	const LABELS: Record<Frequency, string> = { high: 'High', low: 'Low', all: 'All' };
	const offered = $derived(offeredCadences(available));

	// A value bound from outside can name a cadence the data does not hold; the chips never show
	// one chosen that is not offered.
	$effect(() => {
		const held = heldChoice(value, available);
		if (held !== value) value = held;
	});

	function select(val: Frequency) {
		value = val;
		onchange?.();
	}
</script>

<div class="flex gap-0.5" title="High = continuous field-sensor line · Low = grab/spot samples · All = both">
	{#each offered as val (val)}
		<button
			onclick={() => select(val)}
			class="px-2 py-1 text-xs rounded border-none cursor-pointer {value === val
				? 'bg-brand-primary text-white'
				: 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
		>{LABELS[val]}</button>
	{/each}
</div>
