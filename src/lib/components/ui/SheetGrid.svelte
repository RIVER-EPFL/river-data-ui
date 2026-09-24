<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { GridSettings, HotInstance } from 'handsontable';
	import 'handsontable/styles/handsontable.min.css';
	import 'handsontable/styles/ht-theme-classic-no-icons.min.css';
	import './sheetGrid.css';

	/** The lab's use is research under the Non-Commercial License Agreement 4.0, section 2.2(a) (Q206). */
	const LICENSE_KEY = 'non-commercial-and-evaluation';

	interface Props {
		data: unknown[][] | Record<string, unknown>[];
		settings: Omit<GridSettings, 'data' | 'licenseKey' | 'themeName'>;
		onready?: (hot: HotInstance) => void;
		class?: string;
	}

	let { data, settings, onready, class: className = '' }: Props = $props();

	let el: HTMLDivElement;
	let hot = $state<HotInstance | null>(null);

	onMount(async () => {
		const { default: Handsontable } = await import('handsontable');
		if (!el) return;
		const instance = new Handsontable(el, {
			...untrack(() => settings),
			data: untrack(() => data),
			licenseKey: LICENSE_KEY,
			themeName: 'ht-theme-classic',
		});
		hot = instance;
		onready?.(instance);
		document.addEventListener('focusin', leave);
	});

	/** A field outside the grid taking the focus takes the keyboard from the grid with it. */
	function leave(event: FocusEvent) {
		const instance = untrack(() => hot);
		if (!instance || instance.isDestroyed) return;
		if (event.target instanceof Node && !el.contains(event.target)) instance.unlisten();
	}

	/**
	 * Redraw the grid without taking the keyboard: a grid holding a selection puts the focus back on
	 * its cell when it redraws, unless its focus manager is suspended, which leaves a field outside
	 * the grid focused.
	 */
	function redraw(apply: (instance: HotInstance) => void) {
		const instance = untrack(() => hot);
		if (!instance || instance.isDestroyed) return;
		const focus = instance.getFocusManager();
		focus.suspend();
		try {
			apply(instance);
		} finally {
			focus.resume();
		}
	}

	// Rows first: new settings may describe the columns the new rows carry.
	$effect(() => {
		const rows = data;
		redraw((instance) => instance.loadData(rows));
	});

	$effect(() => {
		const next = settings;
		redraw((instance) => instance.updateSettings(next));
	});

	onDestroy(() => {
		document.removeEventListener('focusin', leave);
		if (hot && !hot.isDestroyed) hot.destroy();
		hot = null;
	});
</script>

<div bind:this={el} class="sheet-grid {className}"></div>
