<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Sensor | River Data</title></svelte:head>

<CrudForm
	client={api.sensors}
	title="New Sensor"
	backHref="{base}/sensors"
	fields={[
		{ key: 'serial_number', label: 'Serial Number', helperText: 'Unique hardware identifier' },
		{ key: 'name', label: 'Name' },
		{ key: 'manufacturer', label: 'Manufacturer' },
		{ key: 'model', label: 'Model' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'is_active', label: 'Active', type: 'boolean', defaultValue: true, helperText: 'Inactive sensors are hidden from deployment dropdowns' },
	]}
/>
