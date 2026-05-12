<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Parameter | River Data</title></svelte:head>

<CrudForm
	client={api.parameters}
	title="New Parameter"
	backHref="{base}/parameters"
	fields={[
		{ key: 'name', label: 'Name', required: true },
		{ key: 'display_name', label: 'Display Name', required: true },
		{ key: 'default_units', label: 'Default Units', required: true },
		{ key: 'category', label: 'Category', type: 'select', defaultValue: 'measurement', options: [
			{ value: 'measurement', label: 'Measurement' },
			{ value: 'device_health', label: 'Device Health' },
		] },
		{ key: 'data_type', label: 'Data Type', type: 'select', defaultValue: 'float', options: [
			{ value: 'float', label: 'Float' },
			{ value: 'int', label: 'Integer' },
			{ value: 'string', label: 'String' },
			{ value: 'bool', label: 'Boolean' },
		] },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'default_warning_min', label: 'Warning Min', type: 'number', step: 'any' },
		{ key: 'default_warning_max', label: 'Warning Max', type: 'number', step: 'any' },
		{ key: 'default_alarm_min', label: 'Alarm Min', type: 'number', step: 'any' },
		{ key: 'default_alarm_max', label: 'Alarm Max', type: 'number', step: 'any' },
	]}
/>
