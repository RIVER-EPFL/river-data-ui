<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Sensor | River Data</title></svelte:head>

<!--
	Sensors are parameter-free: a single physical instrument (identified by serial number) that can
	measure across channels/parameters. What it measures is resolved via its deployments, not a fixed
	parameter on the sensor itself.
-->
<CrudForm
	client={api.sensors}
	title="New Sensor"
	backHref="{base}/sensors"
	fields={[
		{ key: 'serial_number', label: 'Serial Number', helperText: 'Device serial - the physical-instrument identity' },
		{ key: 'name', label: 'Name' },
		{ key: 'manufacturer', label: 'Manufacturer' },
		{ key: 'model', label: 'Model' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
		{ key: 'is_lab_instrument', label: 'Lab instrument', type: 'boolean', defaultValue: false, helperText: 'Field/lab instrument taken on trips (sparse grab samples) rather than a fixed station sensor' },
		{ key: 'is_active', label: 'Active', type: 'boolean', defaultValue: true, helperText: 'Inactive sensors are hidden from deployment dropdowns' },
	]}
/>
