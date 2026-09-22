<script lang="ts">
	import { fromDatetimeLocal, toDatetimeLocal } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { BROWSER_ZONE, zoneOptions } from '$lib/time/zones';

	// Takes a timestamp as a wall-clock time plus the zone it is read in, and binds the UTC
	// instant the API stores. The resolved instant is printed under the field, so a time entered
	// for somewhere other than here is seen before it is saved. Changing the zone re-expresses
	// the bound instant rather than moving it.
	let {
		value = $bindable(''),
		id = undefined,
		required = false,
		disabled = false,
		min = undefined,
		max = undefined,
		ariaLabel = undefined,
		compact = false,
		class: klass = '',
		onchange = undefined,
	}: {
		/// The instant, ISO-8601 in UTC. Empty string is no timestamp.
		value?: string;
		id?: string;
		required?: boolean;
		disabled?: boolean;
		/// Bounds as instants, clamped in the chosen zone's wall clock.
		min?: string;
		max?: string;
		ariaLabel?: string;
		/// Drop the resolved-instant line, for a field in a dense row.
		compact?: boolean;
		class?: string;
		onchange?: ((instant: string) => void) | null;
	} = $props();

	let zone = $state(timezoneStore.zone ?? BROWSER_ZONE);
	let wall = $state('');
	// The instant this field last wrote, so an outside change is told apart from its own. It starts
	// empty so the first effect seeds the wall clock from whatever was passed in.
	let written = $state('');

	const options = zoneOptions();
	const resolved = $derived(wall ? fromDatetimeLocal(wall, zone) : '');

	$effect(() => {
		if (value === written) return;
		written = value;
		wall = value ? toDatetimeLocal(value, zone) : '';
	});

	function push(next: string) {
		written = next;
		value = next;
		onchange?.(next);
	}

	function editWall(next: string) {
		wall = next;
		push(next ? fromDatetimeLocal(next, zone) : '');
	}

	function editZone(next: string) {
		zone = next;
		if (written) wall = toDatetimeLocal(written, next);
		else if (wall) push(fromDatetimeLocal(wall, next));
	}
</script>

<div class="flex flex-col gap-1 {klass}">
	<div class="flex items-center gap-1.5">
		<input
			{id}
			{required}
			{disabled}
			type="datetime-local"
			aria-label={ariaLabel}
			min={min ? toDatetimeLocal(min, zone) : undefined}
			max={max ? toDatetimeLocal(max, zone) : undefined}
			value={wall}
			oninput={(e) => editWall(e.currentTarget.value)}
			class="flex-1 min-w-0 px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		/>
		<select
			{disabled}
			aria-label="Time zone"
			value={zone}
			onchange={(e) => editZone(e.currentTarget.value)}
			class="max-w-[10rem] px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-xs"
		>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</div>
	{#if !compact}
		<span class="text-[11px] text-brand-muted tabular-nums">
			{resolved ? `Stored as ${resolved.replace('.000Z', 'Z')}` : 'No timestamp'}
		</span>
	{/if}
</div>
