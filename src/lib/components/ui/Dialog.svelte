<script lang="ts">
	let {
		open = $bindable(false),
		title = '',
		maxWidth = 'sm',
		children,
		actions,
	}: {
		open: boolean;
		title?: string;
		maxWidth?: 'xs' | 'sm' | 'md' | 'lg';
		children: import('svelte').Snippet;
		actions?: import('svelte').Snippet;
	} = $props();

	const widths = { xs: 'max-w-[444px]', sm: 'max-w-[600px]', md: 'max-w-[900px]', lg: 'max-w-[1200px]' };

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	let panel = $state<HTMLElement | null>(null);
	const titleId = `dialog-title-${crypto.randomUUID()}`;

	// The keyboard has to come back where it came from. A dialog opened from the entry grid is
	// opened from a cell the operator is typing in, so a close that leaves focus on the body ends
	// the keyboard path and sends them back to the mouse (M119).
	$effect(() => {
		if (!open) return;
		const opener = document.activeElement as HTMLElement | null;
		queueMicrotask(() => (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus());
		return () => opener?.focus?.();
	});

	function focusable(): HTMLElement[] {
		return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
			return;
		}
		if (e.key !== 'Tab') return;
		// Tab cycles inside the dialog rather than walking out of it into the page behind.
		const cells = focusable();
		if (cells.length === 0) {
			e.preventDefault();
			return;
		}
		const index = cells.indexOf(document.activeElement as HTMLElement);
		const next = e.shiftKey ? index - 1 : index + 1;
		if (next >= 0 && next < cells.length && index !== -1) return;
		e.preventDefault();
		cells[e.shiftKey ? cells.length - 1 : 0].focus();
	}
</script>

<!-- Escape and Tab are bound on the window: the backdrop is never focused, so a keydown on it never fires. -->
<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="presentation"
		onclick={handleBackdrop}
	>
		<!-- The dialog is the panel, not the backdrop: the backdrop is what a click outside lands on. -->
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={title ? titleId : undefined}
			tabindex="-1"
			class="bg-brand-surface rounded-lg shadow-lg w-full {widths[maxWidth]} mx-4 max-h-[90vh] flex flex-col"
		>
			{#if title}
				<div class="px-4 py-3.5 border-b border-brand-divider">
					<h3 id={titleId} class="text-[1.0625rem] font-semibold">{title}</h3>
				</div>
			{/if}
			<div class="px-4 py-3 overflow-y-auto flex-1">
				{@render children()}
			</div>
			{#if actions}
				<div class="px-4 py-3 border-t border-brand-divider flex justify-end gap-2">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
{/if}
