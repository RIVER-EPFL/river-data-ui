<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Constant | River Data</title></svelte:head>

<CrudForm
	client={api.constants}
	title="New Constant"
	backHref="{base}/constants"
	fields={[
		{ key: 'name', label: 'Name', required: true },
		{ key: 'value', label: 'Value', type: 'number', required: true, step: 'any' },
		{ key: 'units', label: 'Units' },
		{ key: 'description', label: 'Description', type: 'textarea' },
	]}
/>
