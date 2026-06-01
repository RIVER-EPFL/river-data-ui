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
		{ key: 'name', label: 'Name', required: true, helperText: 'Canonical ID for formulas and API queries, e.g. dissolved_oxygen' },
		{ key: 'display_name', label: 'Display Name', required: true, helperText: 'Shown in the UI alongside units, e.g. Dissolved Oxygen' },
		{ key: 'default_units', label: 'Default Units', required: true, helperText: 'Measurement unit, e.g. uM, mg/L, NTU' },
		{ key: 'category', label: 'Category', type: 'select', defaultValue: 'measurement', helperText: 'Groups parameters in the UI and public API', options: [
			{ value: 'measurement', label: 'Measurement' },
			{ value: 'device_health', label: 'Device Health' },
		] },
		{ key: 'data_type', label: 'Data Type', type: 'select', defaultValue: 'float', helperText: 'Determines how values are stored and validated', options: [
			{ value: 'float', label: 'Float' },
			{ value: 'int', label: 'Integer' },
			{ value: 'string', label: 'String' },
			{ value: 'bool', label: 'Boolean' },
		] },
		{ key: 'aliases', label: 'Aliases', type: 'tags', helperText: 'Alternative names that resolve to this parameter during CSV import and stream pairing' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'default_warning_min', label: 'Warning Min', type: 'number', step: 'any', helperText: 'Below this value triggers a warning (severity 1)' },
		{ key: 'default_warning_max', label: 'Warning Max', type: 'number', step: 'any', helperText: 'Above this value triggers a warning (severity 1)' },
		{ key: 'default_alarm_min', label: 'Alarm Min', type: 'number', step: 'any', helperText: 'Below this value triggers an alarm (severity 2)' },
		{ key: 'default_alarm_max', label: 'Alarm Max', type: 'number', step: 'any', helperText: 'Above this value triggers an alarm (severity 2)' },
	]}
/>
