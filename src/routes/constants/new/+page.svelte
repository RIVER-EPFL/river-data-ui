<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Constant | River Data</title></svelte:head>

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
