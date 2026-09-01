<script lang="ts">
	import type { Frequency } from '$lib/charts/multiSiteSeries';

	let {
		value = $bindable<Frequency>('high'),
		available = { high: true, low: true },
		onchange,
	}: {
		value?: Frequency;
		/** Which cadences the data actually holds. An unheld one is shown dimmed and refuses selection. */
		available?: { high: boolean; low: boolean };
		onchange?: () => void;
	} = $props();

	const CHIPS: Array<[Frequency, string]> = [
		['high', 'High'],
		['low', 'Low'],
		['all', 'All'],
	];

	function enabled(val: Frequency): boolean {
		if (val === 'all') return available.high || available.low;
		return val === 'high' ? available.high : available.low;
	}

	const MISSING: Record<string, string> = {
		high: 'No continuous (sensor) data here',
		low: 'No low-frequency (grab/spot) data here',
		all: 'No data here',
	};

	function select(val: Frequency) {
		if (!enabled(val)) return;
		value = val;
		onchange?.();
	}
</script>

<div class="flex gap-0.5" title="High = continuous field-sensor line · Low = grab/spot samples · All = both">
	{#each CHIPS as [val, label]}
		{@const on = enabled(val)}
		<button
			onclick={() => select(val)}
			disabled={!on}
			title={on ? undefined : MISSING[val]}
			class="px-2 py-1 text-xs rounded border-none {value === val
				? 'bg-brand-primary text-white'
				: on
					? 'bg-brand-bg text-brand-muted hover:text-brand-text'
					: 'bg-brand-bg text-brand-muted opacity-40 line-through'} {on ? 'cursor-pointer' : 'cursor-not-allowed'}"
		>{label}</button>
	{/each}
</div>
