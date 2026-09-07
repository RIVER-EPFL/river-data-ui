<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Parameter Group | RIVER Data</title></svelte:head>

<CrudForm
	client={api.parameterGroups}
	title="New Parameter Group"
	backHref="{base}/parameters?tab=groups"
	fields={[
		{ key: 'code', label: 'Code', required: true, helperText: 'Stable machine identity, e.g. field_data' },
		{ key: 'label', label: 'Label', required: true, helperText: 'What the group is called on screen' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'ordinal', label: 'Order', type: 'number', step: '1', defaultValue: 0, helperText: 'Where the group sits in the category order' },
	]}
/>
