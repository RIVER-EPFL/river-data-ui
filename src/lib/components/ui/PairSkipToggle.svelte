<script lang="ts">
	// A two-state switch for a pairing decision. `mixed` is a group whose entries disagree; it
	// reads as neither position and its click pairs the whole group.
	let {
		value,
		onchange,
		size = 'md',
		title,
	}: {
		value: 'pair' | 'skip' | 'mixed';
		onchange: (action: 'pair' | 'skip') => void;
		size?: 'sm' | 'md';
		title?: string;
	} = $props();

	const on = $derived(value === 'pair');
	const track = $derived(
		value === 'pair'
			? 'bg-severity-ok border-severity-ok-border'
			: value === 'skip'
				? 'bg-severity-alarm border-severity-alarm-border'
				: 'bg-brand-divider border-brand-divider',
	);
	const label = $derived(value === 'pair' ? 'Pair' : value === 'skip' ? 'Skip' : 'Mixed');
	const labelColor = $derived(
		value === 'pair'
			? 'text-severity-ok'
			: value === 'skip'
				? 'text-severity-alarm'
				: 'text-brand-muted',
	);
	const dims = $derived(
		size === 'sm'
			? { track: 'w-7 h-4', knob: 'w-3 h-3', shift: on ? 'translate-x-3' : 'translate-x-0.5', text: 'text-[11px] w-8' }
			: { track: 'w-9 h-5', knob: 'w-4 h-4', shift: on ? 'translate-x-4' : 'translate-x-0.5', text: 'text-xs w-9' },
	);
</script>

<button
	type="button"
	role="switch"
	aria-checked={on}
	aria-label="Pair this stream"
	{title}
	onclick={() => onchange(on ? 'skip' : 'pair')}
	class="inline-flex items-center gap-1.5 shrink-0 bg-transparent border-none p-0 cursor-pointer"
>
	<span class="relative inline-block rounded-full border transition-colors {track} {dims.track}">
		<span
			class="absolute top-1/2 -translate-y-1/2 left-0 rounded-full bg-white shadow-sm transition-transform {dims.knob} {dims.shift}"
		></span>
	</span>
	<span class="font-medium text-left {labelColor} {dims.text}">{label}</span>
</button>
