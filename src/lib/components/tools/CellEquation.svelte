<script lang="ts">
	import type { RunTraceStep } from '$api/service';
	import { equationChain, type EquationBinding, type EquationStep } from '$lib/tools/equation';

	// The arithmetic behind one computed cell: the formula, every variable with the value it was
	// bound to, and the result. Walked, it carries on down through the steps that fed it until it
	// reaches the values the run was given.
	let {
		steps,
		code,
		index = null,
		walk = false,
		origin,
		anchor,
	}: {
		steps: RunTraceStep[];
		/** The step to open on: a formula's code, or a catalog parameter code it writes. */
		code: string;
		/** The replicate index for a per-replicate step. */
		index?: number | null;
		/** Carry on into the steps the variables came from, for a reader with no table to link to. */
		walk?: boolean;
		/** Where a variable that is not a step came from, one line. */
		origin?: (name: string) => string | null;
		/** Link target for a variable that is a step, when the reader has its row on screen. */
		anchor?: (step: string) => string;
	} = $props();

	const chain = $derived(equationChain(steps, code, index, walk));

	function fmt(value: number | null): string {
		if (value === null) return '--';
		return Number.isInteger(value) ? String(value) : value.toPrecision(6);
	}

	function binding(b: EquationBinding): string | null {
		return b.step ? null : (origin?.(b.name) ?? null);
	}
</script>

{#snippet equation(step: EquationStep)}
	<p class="font-mono text-xs break-all mb-2">{step.formula}</p>
	{#if step.bindings.length > 0}
		<dl class="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
			{#each step.bindings as b (b.name)}
				<dt class="font-mono">
					{#if b.step && anchor}
						<a href={anchor(b.step)} class="text-brand-primary hover:underline">{b.name}</a>
					{:else}
						{b.name}
					{/if}
					{#if binding(b)}
						<span class="ml-1 font-sans text-brand-muted">{binding(b)}</span>
					{/if}
				</dt>
				<dd class="font-mono text-right">{fmt(b.value)}</dd>
			{/each}
		</dl>
	{/if}
	<p class="font-mono text-xs mt-2 pt-2 border-t border-brand-divider">= {fmt(step.value)}</p>
{/snippet}

{#if chain.length > 0}
	<div class="text-left font-sans font-normal whitespace-normal">
		{@render equation(chain[0])}
		{#each chain.slice(1) as step (step.key)}
			<div class="mt-3 pt-3 border-t border-brand-divider">
				<p class="text-[11px] text-brand-muted mb-1">{step.label}</p>
				{@render equation(step)}
			</div>
		{/each}
	</div>
{/if}
