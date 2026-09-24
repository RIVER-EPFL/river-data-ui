<script lang="ts" module>
	export const HARNESS_MIN = Date.UTC(2026, 8, 1);
	export const HARNESS_MAX = Date.UTC(2026, 8, 23, 12, 30);
	export const HARNESS_START = Date.UTC(2026, 8, 16);
</script>

<script lang="ts">
	import TimeRangeSlider from './TimeRangeSlider.svelte';

	// A caller holding each value in its own state, as a page binding the range does, mounted on
	// bounds it already has.
	let min = $state(HARNESS_MIN);
	let max = $state(HARNESS_MAX);
	let start = $state(HARNESS_START);
	let end = $state(HARNESS_MAX);

	export function setBounds(nextMin: number, nextMax: number, nextStart: number, nextEnd: number) {
		min = nextMin;
		max = nextMax;
		start = nextStart;
		end = nextEnd;
	}

	export function setRange(nextStart: number, nextEnd: number) {
		start = nextStart;
		end = nextEnd;
	}
</script>

<TimeRangeSlider {min} {max} bind:start bind:end />
