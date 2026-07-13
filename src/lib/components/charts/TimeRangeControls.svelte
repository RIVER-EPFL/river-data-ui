<script lang="ts">
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { fetchSiteExtent } from '$lib/charts/multiSiteSeries';

	let {
		siteIds = [],
		start = $bindable(0),
		end = $bindable(0),
		label = 'Time range',
	}: {
		siteIds?: string[];
		start: number;
		end: number;
		label?: string;
	} = $props();

	// Slider bounds derived from the selected sites' data extent; seeded to the last 7 days.
	const seedMax = Date.now();
	const seedMin = seedMax - 7 * 86400000;
	let boundMin = $state(seedMin);
	let boundMax = $state(seedMax);
	if (!start && !end) {
		start = seedMin;
		end = seedMax;
	}

	function clamp(value: number): number {
		if (boundMin >= boundMax) return value;
		return Math.min(boundMax, Math.max(boundMin, value));
	}

	async function refreshBounds(ids: string[]) {
		if (ids.length === 0) return;
		const extents = await Promise.all(ids.map(fetchSiteExtent));
		const mins = extents.map((e) => e.min).filter((v): v is number => v != null);
		const maxs = extents.map((e) => e.max).filter((v): v is number => v != null);
		if (mins.length === 0 || maxs.length === 0) return;
		const newMin = Math.min(...mins);
		const newMax = Math.max(...maxs);
		if (newMin >= newMax) return;
		boundMin = newMin;
		boundMax = newMax;
		if (start < boundMin || start > boundMax) start = boundMin;
		if (end > boundMax || end < boundMin) end = boundMax;
		if (start >= end) {
			start = boundMin;
			end = boundMax;
		}
	}

	// Recompute slider bounds whenever the active site selection changes
	$effect(() => {
		void refreshBounds(siteIds);
	});

	function onSliderChange(s: number, e: number) {
		start = s;
		end = e;
	}

	// Manual datetime entry uses datetime-local strings (in the active display zone), clamped to bounds.
	function toLocalInput(ms: number): string {
		return ms ? toDatetimeLocal(ms, timezoneStore.zone) : '';
	}

	function onStartInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		if (!value) return;
		const ms = clamp(new Date(fromDatetimeLocal(value, timezoneStore.zone)).getTime());
		start = Math.min(ms, end);
	}

	function onEndInput(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		if (!value) return;
		const ms = clamp(new Date(fromDatetimeLocal(value, timezoneStore.zone)).getTime());
		end = Math.max(ms, start);
	}
</script>

<div>
	<span class="text-sm font-medium block mb-1">{label}</span>
	{#if boundMin < boundMax}
		<div class="px-1 pb-6">
			<TimeRangeSlider min={boundMin} max={boundMax} bind:start bind:end onchange={onSliderChange} />
		</div>
	{:else}
		<p class="text-xs text-brand-muted">Select a site to set the time range.</p>
	{/if}
	<div class="grid grid-cols-2 gap-2 mt-1">
		<label class="block">
			<span class="text-xs text-brand-muted block mb-1">Start</span>
			<input
				type="datetime-local"
				value={toLocalInput(start)}
				min={boundMin ? toLocalInput(boundMin) : undefined}
				max={boundMax ? toLocalInput(boundMax) : undefined}
				oninput={onStartInput}
				class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
			/>
		</label>
		<label class="block">
			<span class="text-xs text-brand-muted block mb-1">End</span>
			<input
				type="datetime-local"
				value={toLocalInput(end)}
				min={boundMin ? toLocalInput(boundMin) : undefined}
				max={boundMax ? toLocalInput(boundMax) : undefined}
				oninput={onEndInput}
				class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
			/>
		</label>
	</div>
</div>
