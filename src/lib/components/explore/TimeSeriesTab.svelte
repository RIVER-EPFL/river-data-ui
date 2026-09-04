<script lang="ts">
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import { emptyTimeSeriesSpec, type TimeSeriesSpec } from '$lib/explore/chartSpecs';
	import Button from '$components/ui/Button.svelte';
	import TimeSeriesChart from './TimeSeriesChart.svelte';

	let {
		sites,
		params,
		siteParams,
		specs = $bindable(),
	}: {
		sites: Site[];
		params: Parameter[];
		siteParams: SiteParameter[];
		specs: TimeSeriesSpec[];
	} = $props();

	if (specs.length === 0) specs = [emptyTimeSeriesSpec()];

	// A new chart starts as a copy of the last one, so the operator changes only what differs.
	function addChart() {
		const last = specs[specs.length - 1];
		specs = [...specs, { ...last, siteIds: [...last.siteIds] }];
	}

	function removeChart(i: number) {
		if (specs.length <= 1) return;
		specs = specs.filter((_, j) => j !== i);
	}
</script>

<div class="space-y-4">
	<div class="flex justify-end">
		<Button size="sm" onclick={addChart}>Add chart</Button>
	</div>
	<div class="grid grid-cols-1 2xl:grid-cols-2 gap-4">
		{#each specs as _, i}
			<TimeSeriesChart
				{sites}
				{params}
				{siteParams}
				bind:spec={specs[i]}
				index={i}
				removable={specs.length > 1}
				onremove={() => removeChart(i)}
			/>
		{/each}
	</div>
</div>
