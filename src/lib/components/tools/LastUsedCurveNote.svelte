<script lang="ts">
	import type { LastUsedCurve } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import { formatDate } from '$lib/utils';

	// One line naming the instrument and curve the last grab at a slot recorded, with the tip
	// explaining how the answer was decided.
	let {
		last,
		canUse = false,
		onuse,
	}: {
		last: LastUsedCurve | null;
		/// Whether the curve named here can be taken for this save. It is offered, never applied:
		/// a curve is declared by the operator, never inherited from the last visit.
		canUse?: boolean;
		onuse?: () => void;
	} = $props();

	function line(l: LastUsedCurve): string {
		const instrument = l.sensor_name ?? l.sensor_id ?? 'unnamed instrument';
		const curve = l.curve_name
			? `${l.curve_name}${l.curve_created_at ? ` (${formatDate(l.curve_created_at)})` : ''}`
			: 'no curve';
		return `${instrument}, ${curve}`;
	}
</script>

{#if last}
	<div class="flex items-center gap-1 text-xs text-brand-muted">
		Last used here: {line(last)}
		{#if canUse && onuse}
			<Button variant="secondary" size="sm" onclick={onuse}>Use this curve</Button>
		{/if}
		<span class="group relative inline-block">
			<button
				type="button"
				class="flex h-4 w-4 items-center justify-center rounded-full border border-brand-divider text-[10px] font-normal text-brand-muted"
				aria-label="How the last used curve is found"
			>
				i
			</button>
			<div
				class="absolute left-0 top-5 z-20 hidden w-72 rounded-md border border-brand-divider bg-brand-surface p-2.5 text-left text-xs font-normal text-brand-text shadow-lg group-hover:block group-focus-within:block"
				role="tooltip"
			>
				{last.method}
			</div>
		</span>
	</div>
{/if}
