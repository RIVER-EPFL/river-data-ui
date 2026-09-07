<script lang="ts">
	import VisualFormulaBuilder from './VisualFormulaBuilder.svelte';
	import type { Constant } from '$api/crud';

	let {
		value = $bindable(''),
		variables = [],
		constants = []
	}: {
		value?: string;
		variables?: Array<{ name: string; label: string; category?: string }>;
		constants?: Constant[];
	} = $props();
</script>

<VisualFormulaBuilder bind:value {variables} {constants} />
<output data-testid="formula">{value}</output>
