<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import uPlot from 'uplot';
	import 'uplot/dist/uPlot.min.css';

	let {
		options,
		data,
		class: className = '',
	}: {
		options: uPlot.Options;
		data: uPlot.AlignedData;
		class?: string;
	} = $props();

	let el: HTMLDivElement;
	let chart: uPlot | null = null;

	function create() {
		if (chart) chart.destroy();
		if (!el || !data[0]?.length) return;

		const rect = el.getBoundingClientRect();
		const opts: uPlot.Options = {
			...options,
			width: rect.width,
			height: options.height ?? 300,
		};
		chart = new uPlot(opts, data, el);
	}

	function handleResize() {
		if (!chart || !el) return;
		const rect = el.getBoundingClientRect();
		chart.setSize({ width: rect.width, height: options.height ?? 300 });
	}

	$effect(() => {
		if (el && data) create();
	});

	onMount(() => {
		window.addEventListener('resize', handleResize);
	});

	onDestroy(() => {
		window.removeEventListener('resize', handleResize);
		chart?.destroy();
	});
</script>

<div bind:this={el} class="w-full {className}"></div>
