<script lang="ts" module>
	import type uPlotType from 'uplot';

	/** The wrapper measures the container, so a caller states everything but the width. */
	export type ChartOptions = Omit<uPlotType.Options, 'width'> & { width?: number };
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';

	// The one place a uPlot instance is constructed, sized and destroyed. A caller supplies the
	// options and the data; anything it must attach to the live instance (a dblclick, a hit test on
	// an overlay strip) goes in `onCreate`, which returns whatever undoes it.
	let {
		options,
		data,
		class: className = '',
		onCreate,
	}: {
		options: ChartOptions;
		data: uPlot.AlignedData;
		class?: string;
		onCreate?: (chart: uPlot) => (() => void) | void;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;
	let teardown: (() => void) | null = null;

	function destroy() {
		teardown?.();
		teardown = null;
		chart?.destroy();
		chart = null;
	}

	function height(): number {
		return options.height ?? 300;
	}

	function create() {
		destroy();
		if (!el || !data[0]?.length) return;

		const width = el.getBoundingClientRect().width;
		if (width === 0) return;
		chart = new uPlot({ ...options, width, height: height() } as uPlot.Options, data, el);
		teardown = onCreate?.(chart) ?? null;
	}

	// Depend on `options` as well as `data` so a re-render driven only by an options change
	// (e.g. the global timezone toggle changing tzDate, with unchanged data) re-inits the chart.
	$effect(() => {
		if (el && data && options) create();
	});

	// A ResizeObserver rather than a window listener: it also covers a chart mounted in a
	// zero-width container (a just-expanded table row), where a window resize never fires.
	$effect(() => {
		if (!el) return;
		const observer = new ResizeObserver(() => {
			const width = el.getBoundingClientRect().width;
			if (width === 0) return;
			if (chart) chart.setSize({ width, height: height() });
			else create();
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	onDestroy(destroy);
</script>

<div bind:this={el} class="w-full {className}"></div>
