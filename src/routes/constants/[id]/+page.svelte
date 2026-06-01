<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>Edit Constant | River Data</title></svelte:head>

<CrudForm
	client={api.constants}
	entityId={page.params.id}
	title="Edit Constant"
	backHref="{base}/constants"
	fields={[
		{ key: 'name', label: 'Name', required: true, helperText: 'Identifier used in formulas, e.g. molar_weight_o2' },
		{ key: 'value', label: 'Value', type: 'number', required: true, step: 'any', helperText: 'Numeric constant value' },
		{ key: 'units', label: 'Units', helperText: 'Unit of the constant, e.g. g/mol' },
		{ key: 'description', label: 'Description', type: 'textarea' },
	]}
/>
