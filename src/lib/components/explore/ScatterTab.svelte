<script lang="ts">
	import { untrack } from 'svelte';
	import type { Site, Parameter, SiteParameter } from '$api/crud';
	import { emptyScatterSpec, type ScatterSpec } from '$lib/explore/chartSpecs';
	import Button from '$components/ui/Button.svelte';
	import ScatterChart from './ScatterChart.svelte';

	let {
		sites,
		params,
		siteParams,
		specs = $bindable(),
		defaultSiteId = '',
	}: {
		sites: Site[];
		params: Parameter[];
		siteParams: SiteParameter[];
		specs: ScatterSpec[];
		defaultSiteId?: string;
	} = $props();

	// First visit: one chart, on the site already picked on the Time Series tab.
	if (specs.length === 0) specs = [emptyScatterSpec(untrack(() => defaultSiteId))];

	// A new chart starts as a copy of the last one, so the operator changes only what differs.
	function addChart() {
		specs = [...specs, { ...specs[specs.length - 1] }];
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
			<ScatterChart
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
