<script lang="ts">
	import type { Snippet } from 'svelte';

	// A row's secondary actions behind one button. The panel is fixed to the viewport rather than
	// to the row, so a table that scrolls or clips cannot cut it off.
	let {
		label,
		children,
	}: {
		/** The button's accessible name, e.g. "Actions for Dissolved oxygen". */
		label: string;
		/** The menu's items, given the function that closes it. */
		children: Snippet<[() => void]>;
	} = $props();

	let open = $state(false);
	let button = $state<HTMLButtonElement>();
	let panel = $state<HTMLDivElement>();
	let top = $state(0);
	let right = $state(0);

	function close() {
		open = false;
	}

	function toggle(e: MouseEvent) {
		e.stopPropagation();
		if (!open && button) {
			const r = button.getBoundingClientRect();
			top = r.bottom + 4;
			right = window.innerWidth - r.right;
		}
		open = !open;
	}

	$effect(() => {
		if (!open) return;
		const outside = (e: MouseEvent) => {
			const target = e.target as Node;
			if (!panel?.contains(target) && !button?.contains(target)) close();
		};
		const escape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
		};
		const scrolled = (e: Event) => {
			if (!panel?.contains(e.target as Node)) close();
		};
		document.addEventListener('mousedown', outside);
		document.addEventListener('keydown', escape);
		window.addEventListener('scroll', scrolled, true);
		return () => {
			document.removeEventListener('mousedown', outside);
			document.removeEventListener('keydown', escape);
			window.removeEventListener('scroll', scrolled, true);
		};
	});
</script>

<button
	bind:this={button}
	type="button"
	aria-haspopup="menu"
	aria-expanded={open}
	aria-label={label}
	title={label}
	class="cursor-pointer rounded border-none bg-transparent px-2 py-0.5 text-base leading-none text-brand-muted hover:bg-brand-bg hover:text-brand-text"
	onclick={toggle}
>⋯</button>
{#if open}
	<div
		bind:this={panel}
		role="menu"
		tabindex="-1"
		class="fixed z-50 flex min-w-[10rem] flex-col items-stretch gap-0.5 rounded-md border border-brand-divider bg-brand-surface p-1 shadow-lg"
		style="top: {top}px; right: {right}px"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		{@render children(close)}
	</div>
{/if}
