<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import noUiSlider, { PipsMode, type API, type Options } from 'nouislider';
	import 'nouislider/dist/nouislider.css';
	import { tokens } from '$lib/charts/tokens';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { pipLabel } from '$lib/charts/timeRangePips';
	import { dayStart, formatInstant } from '$lib/utils';

	let {
		min,
		max,
		start = $bindable<number>(0),
		end = $bindable<number>(0),
		onchange,
	}: {
		min: number;
		max: number;
		start: number;
		end: number;
		onchange?: (start: number, end: number) => void;
	} = $props();

	let el: HTMLDivElement;
	let slider: API | null = null;
	let suppressUpdate = false;

	const rangeDays = $derived((max - min) / 86400000);
	const todayStart = $derived(dayStart(max, timezoneStore.zone));
	const weekStart = $derived(todayStart - 7 * 86400000);

	// Matching the React dashboard: grey (history), blue (week), green (today)
	// Light versions for track background, full for labels
	const COL_HISTORY = tokens.brand.textMuted;
	const COL_WEEK = tokens.brand.primary;
	const COL_TODAY = tokens.severity.ok.fill;
	const COL_HISTORY_LIGHT = tokens.slider.historyTrack;
	const COL_WEEK_LIGHT = tokens.slider.weekTrack;
	const COL_TODAY_LIGHT = tokens.slider.todayTrack;

	const zones = $derived.by(() => {
		if (rangeDays > 8) {
			return [
				{ label: 'History', width: '50%', color: COL_HISTORY },
				{ label: 'Last week', width: '30%', color: COL_WEEK },
				{ label: 'Today', width: '20%', color: COL_TODAY },
			];
		} else if (rangeDays > 2) {
			return [
				{ label: 'This week', width: '70%', color: COL_WEEK },
				{ label: 'Today', width: '30%', color: COL_TODAY },
			];
		} else {
			return [{ label: 'All data', width: '100%', color: COL_WEEK }];
		}
	});

	const trackGradient = $derived.by(() => {
		if (rangeDays > 8) {
			return `linear-gradient(to right, ${COL_HISTORY_LIGHT} 0%, ${COL_HISTORY_LIGHT} 50%, ${COL_WEEK_LIGHT} 50%, ${COL_WEEK_LIGHT} 80%, ${COL_TODAY_LIGHT} 80%, ${COL_TODAY_LIGHT} 100%)`;
		} else if (rangeDays > 2) {
			return `linear-gradient(to right, ${COL_WEEK_LIGHT} 0%, ${COL_WEEK_LIGHT} 70%, ${COL_TODAY_LIGHT} 70%, ${COL_TODAY_LIGHT} 100%)`;
		}
		return COL_WEEK_LIGHT;
	});

	export function setRange(newStart: number, newEnd: number) {
		if (slider) {
			suppressUpdate = true;
			slider.set([newStart, newEnd]);
			suppressUpdate = false;
		}
	}

	function buildSliderRange(): Options['range'] {
		if (rangeDays > 8) {
			return { 'min': min, '50%': weekStart, '80%': todayStart, 'max': max } as any;
		} else if (rangeDays > 2) {
			return { 'min': min, '70%': todayStart, 'max': max } as any;
		}
		return { min, max };
	}

	function buildPips() {
		const format = { to: (v: number) => pipLabel(v, { max, rangeDays }, timezoneStore.zone) };
		if (rangeDays > 8) {
			return { mode: PipsMode.Positions as const, values: [0, 25, 50, 65, 80, 90, 100], density: 100, format };
		} else if (rangeDays > 2) {
			return { mode: PipsMode.Positions as const, values: [0, 20, 40, 60, 85, 100], density: 100, format };
		}
		return { mode: PipsMode.Count as const, values: 6, density: 100, format };
	}

	function initSlider() {
		if (slider) slider.destroy();
		if (!el || min >= max) return;

		if (!start) start = Math.max(min, max - 604800000);
		if (!end) end = max;

		noUiSlider.create(el, {
			start: [start, end],
			connect: true,
			range: buildSliderRange(),
			step: 600000,
			tooltips: [
				{ to: (v: number) => formatInstant(v) },
				{ to: (v: number) => formatInstant(v) },
			],
			pips: buildPips(),
		});

		slider = (el as any).noUiSlider!;
		// The step snaps an instant off it, and a range that disagrees with the slider is set again
		// by the sync below, which locks the handles for the animation.
		const [snappedStart, snappedEnd] = (slider!.get() as string[]).map(Number);
		if (snappedStart !== start) start = snappedStart;
		if (snappedEnd !== end) end = snappedEnd;
		slider!.on('change', (values: (string | number)[]) => {
			if (suppressUpdate) return;
			start = Number(values[0]);
			end = Number(values[1]);
			onchange?.(start, end);
		});
		slider!.on('update', () => requestAnimationFrame(clampTooltips));
	}

	function clampTooltips() {
		const container = el?.parentElement;
		if (!container) return;
		const bounds = container.getBoundingClientRect();
		container.querySelectorAll<HTMLElement>('.noUi-tooltip').forEach((tt) => {
			tt.style.transform = 'translate(-50%, 0)';
			const r = tt.getBoundingClientRect();
			if (r.left < bounds.left) {
				tt.style.transform = `translate(calc(-50% + ${bounds.left - r.left}px), 0)`;
			} else if (r.right > bounds.right) {
				tt.style.transform = `translate(calc(-50% - ${r.right - bounds.right}px), 0)`;
			}
		});
	}

	// Re-init on new bounds or a timezone-preference toggle, so the range, pip labels and tooltips
	// (baked in at create) refresh. The range the slider reports is not a reason to rebuild it.
	$effect(() => {
		void timezoneStore.zone;
		if (el && min < max) untrack(initSlider);
	});

	$effect(() => {
		if (slider && start && end) {
			const cur = slider.get() as string[];
			if (Math.abs(Number(cur[0]) - start) > 1000 || Math.abs(Number(cur[1]) - end) > 1000) {
				suppressUpdate = true;
				slider.set([start, end]);
				suppressUpdate = false;
			}
		}
	});

	onDestroy(() => slider?.destroy());
</script>

<div class="slider-container" style:--track-bg={trackGradient}>
	<div bind:this={el} class="slider-track"></div>
	<div class="zone-labels">
		{#each zones as zone}
			<div class="zone-label" style="width:{zone.width};color:{zone.color}">{zone.label}</div>
		{/each}
	</div>
</div>

<style>
	.slider-container {
		padding: 0 8px;
	}
	.slider-track {
		height: 14px;
	}
	/* Track background uses zone gradient - !important to override noUiSlider defaults */
	.slider-track :global(.noUi-target) {
		background: var(--track-bg) !important;
		border: none !important;
		border-radius: 7px !important;
		box-shadow: none !important;
		height: 14px !important;
	}
	.slider-track :global(.noUi-base) {
		border-radius: 7px !important;
	}
	/* Selected range darkens the underlying track */
	.slider-track :global(.noUi-connect) {
		background: rgba(0,0,0,0.18) !important;
		border-radius: 7px !important;
	}
	/* Handles */
	.slider-track :global(.noUi-handle) {
		width: 20px !important;
		height: 20px !important;
		border-radius: 50% !important;
		top: -4px !important;
		right: -10px !important;
		border: 2.5px solid var(--color-brand-primary, #1F4E79) !important;
		background: white !important;
		box-shadow: 0 1px 4px rgba(0,0,0,0.25) !important;
		cursor: grab !important;
	}
	.slider-track :global(.noUi-handle::before),
	.slider-track :global(.noUi-handle::after) {
		display: none !important;
	}
	/* Tooltips below handles */
	.slider-track :global(.noUi-tooltip) {
		font-size: 10px;
		padding: 2px 6px;
		border: 1px solid var(--color-brand-divider, #E2E5EA);
		background: white;
		color: var(--color-brand-text, #1B2330);
		border-radius: 4px;
		bottom: auto !important;
		top: 140% !important;
	}
	/* Pips */
	.slider-track :global(.noUi-pips) {
		height: 20px;
		padding: 0;
		top: 100%;
	}
	.slider-track :global(.noUi-marker) {
		background: rgba(0,0,0,0.12);
	}
	.slider-track :global(.noUi-value) {
		font-size: 9px;
		color: var(--color-brand-muted);
		top: 8px;
	}
	/* Zone labels */
	.zone-labels {
		display: flex;
		margin-top: 24px;
	}
	.zone-label {
		font-size: 10px;
		font-weight: 600;
		text-align: center;
	}
</style>
