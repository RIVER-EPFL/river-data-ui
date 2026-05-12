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

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
		role="dialog"
		aria-modal="true"
		onclick={handleBackdrop}
		onkeydown={handleKeydown}
	>
		<div class="bg-brand-surface rounded-lg shadow-lg w-full {widths[maxWidth]} mx-4 max-h-[90vh] flex flex-col">
			{#if title}
				<div class="px-4 py-3.5 border-b border-brand-divider">
					<h3 class="text-[1.0625rem] font-semibold">{title}</h3>
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
