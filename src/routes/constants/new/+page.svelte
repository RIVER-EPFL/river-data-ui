<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { api } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { AUTHOR_CALCULATIONS, CONSTANTS_REFUSED } from '$lib/toolbox/authoring';
</script>

<svelte:head><title>New Constant | RIVER Data</title></svelte:head>

{#if !me.can(AUTHOR_CALCULATIONS)}
	<ErrorNotice message={CONSTANTS_REFUSED} />
{:else}
	<CrudForm
		client={api.constants}
		title="New Constant"
		backHref="{base}/parameters?tab=constants"
		fields={[
			{ key: 'name', label: 'Name', required: true, helperText: 'Identifier used in formulas, e.g. molar_weight_o2' },
			{ key: 'value', label: 'Value', type: 'number', required: true, step: 'any', helperText: 'Numeric constant value' },
			{ key: 'units', label: 'Units', helperText: 'Unit of the constant, e.g. g/mol' },
			{ key: 'description', label: 'Description', type: 'textarea' },
		]}
	/>
{/if}
