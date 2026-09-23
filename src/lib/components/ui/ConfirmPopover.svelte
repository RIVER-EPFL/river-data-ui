<script lang="ts">
	import Button from './Button.svelte';

	let {
		message = 'Are you sure?',
		confirmLabel = 'Confirm',
		confirmVariant = 'alarm',
		above = false,
		onconfirm,
		children,
		detail,
	}: {
		message?: string;
		confirmLabel?: string;
		confirmVariant?: 'alarm' | 'primary';
		above?: boolean;
		onconfirm: () => void;
		children: import('svelte').Snippet;
		detail?: import('svelte').Snippet;
	} = $props();

	let open = $state(false);
</script>

<div class="relative inline-block">
	<div onclick={() => (open = !open)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (open = !open)}>
		{@render children()}
	</div>
	{#if open}
		<div class="absolute z-40 right-0 bg-brand-surface border border-brand-divider rounded-md shadow-lg p-3 min-w-[200px] max-w-sm w-max {above ? 'bottom-full mb-1' : 'top-full mt-1'}">
			<p class="text-sm {detail ? 'mb-2' : 'mb-3'}">{message}</p>
			{#if detail}
				<div class="mb-3">{@render detail()}</div>
			{/if}
			<div class="flex gap-2 justify-end">
				<Button variant="secondary" size="sm" onclick={() => (open = false)}>Cancel</Button>
				<Button
					variant={confirmVariant === 'primary' ? 'primary' : 'danger'}
					size="sm"
					onclick={() => { onconfirm(); open = false; }}
				>
					{confirmLabel}
				</Button>
			</div>
		</div>
	{/if}
</div>
