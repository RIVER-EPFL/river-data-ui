<script lang="ts">
	import TimeRangeSlider from '$components/charts/TimeRangeSlider.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
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

	// Manual entry binds instants, clamped to the bounds the slider spans.
	const asInstant = (ms: number): string => (ms ? new Date(ms).toISOString() : '');

	function onStartInput(instant: string) {
		if (!instant) return;
		start = Math.min(clamp(new Date(instant).getTime()), end);
	}

	function onEndInput(instant: string) {
		if (!instant) return;
		end = Math.max(clamp(new Date(instant).getTime()), start);
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
			<TimestampInput
				ariaLabel="Start"
				value={asInstant(start)}
				min={asInstant(boundMin)}
				max={asInstant(boundMax)}
				onchange={onStartInput}
			/>
		</label>
		<label class="block">
			<span class="text-xs text-brand-muted block mb-1">End</span>
			<TimestampInput
				ariaLabel="End"
				value={asInstant(end)}
				min={asInstant(boundMin)}
				max={asInstant(boundMax)}
				onchange={onEndInput}
			/>
		</label>
	</div>
</div>
