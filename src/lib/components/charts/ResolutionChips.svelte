<script lang="ts">
	type Override = 'auto' | 'raw' | 'hourly' | 'daily';

	let {
		value = $bindable<Override>('auto'),
		effective,
		onchange,
	}: {
		value?: Override;
		effective: 'raw' | 'hourly' | 'daily';
		onchange?: () => void;
	} = $props();

	const CHIPS: Array<[Override, string]> = [
		['auto', 'Auto'],
		['raw', 'Raw'],
		['hourly', 'Hourly'],
		['daily', 'Daily'],
	];
</script>

<div class="flex gap-0.5">
	{#each CHIPS as [val, label]}
		<button
			onclick={() => { value = val; onchange?.(); }}
			class="px-2 py-1 text-xs rounded cursor-pointer border-none {value === val ? 'bg-brand-primary text-white' : 'bg-brand-bg text-brand-muted hover:text-brand-text'}"
		>{label}{val === 'auto' && value === 'auto' ? ` (${effective})` : ''}</button>
	{/each}
</div>
