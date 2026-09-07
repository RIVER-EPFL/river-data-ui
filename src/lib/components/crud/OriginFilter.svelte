<script lang="ts">
	import { originLabel, type Origin } from '$lib/origin';

	// One control, the same question on every list: where did this row come from. `sources` is the
	// source systems the list can offer; a list whose rows only carry the sync stamp passes none.
	let {
		value = $bindable('any' as Origin),
		sources = [],
		onchange,
	}: {
		value?: Origin;
		sources?: string[];
		onchange: () => void;
	} = $props();
</script>

<select
	bind:value
	{onchange}
	title="Where these rows came from"
	class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
>
	<option value="any">Any origin</option>
	<option value="manual">Entered by hand</option>
	<option value="sync">Arrived from a sync</option>
	{#each sources as source}
		<option value="source:{source}">From {originLabel(source)}</option>
	{/each}
</select>
