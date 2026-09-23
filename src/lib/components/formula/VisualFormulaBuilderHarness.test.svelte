<script lang="ts">
	import VisualFormulaBuilder from './VisualFormulaBuilder.svelte';
	import FormulaPalette from './FormulaPalette.svelte';
	import type { Constant } from '$api/crud';

	let {
		value = $bindable(''),
		variables = [],
		constants = [],
		outside = false
	}: {
		value?: string;
		variables?: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
		/** Mount the palette beside the builder rather than inside it, as the calculation page does. */
		outside?: boolean;
	} = $props();

	let builder = $state<VisualFormulaBuilder | null>(null);
</script>

{#if outside}
	<FormulaPalette {variables} {constants} onpick={(payload) => builder?.pick(payload)} />
{/if}
<VisualFormulaBuilder bind:this={builder} bind:value {variables} {constants} palette={!outside} />
<output data-testid="formula">{value}</output>
