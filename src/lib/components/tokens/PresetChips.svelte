<script lang="ts">
	// Quick-set buttons for a numeric field (expiry duration in days, or rate-limit rps).
	// `onpick` receives the chosen value; the parent decides what to do with it.
	let {
		options,
		onpick,
		active,
	}: {
		options: { label: string; value: number }[];
		onpick: (value: number) => void;
		active?: (value: number) => boolean;
	} = $props();
</script>

<div class="flex flex-wrap gap-1.5">
	{#each options as o}
		<button
			type="button"
			onclick={() => onpick(o.value)}
			class="text-xs px-2.5 py-0.5 rounded-full border cursor-pointer {active?.(o.value)
				? 'border-brand-primary bg-brand-primary text-white'
				: 'border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg'}"
		>
			{o.label}
		</button>
	{/each}
</div>
