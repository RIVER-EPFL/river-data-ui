<script lang="ts">
	import type { InstrumentLabel } from '$lib/pairing/planGroups';

	// How a parameter or a stream names the instrument measuring it. The instrument is chosen on the
	// Instruments tab, so this reads it and opens it there rather than offering a second picker.
	let {
		instruments,
		onopen,
	}: {
		instruments: InstrumentLabel[];
		onopen: () => void;
	} = $props();

	const one = $derived(instruments.length === 1 ? instruments[0] : null);
	const none = $derived(instruments.some((i) => i.none));
	const text = $derived(
		one ? (one.isNew ? `+ ${one.name}` : one.name) : `${instruments.length} instruments`,
	);
</script>

{#if instruments.length > 0}
	<button
		onclick={onopen}
		title={one ? 'Open on the Instruments tab' : instruments.map((i) => i.name).join(', ')}
		class="bg-transparent border-none p-0 cursor-pointer text-left text-xs hover:underline {none ? 'text-severity-warning-text' : 'text-brand-primary'}"
	>{text}</button>
{/if}
