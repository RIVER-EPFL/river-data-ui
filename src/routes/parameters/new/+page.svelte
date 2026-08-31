<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Parameter | RIVER Data</title></svelte:head>

<CrudForm
	client={api.parameters}
	title="New Parameter"
	backHref="{base}/parameters"
	fields={[
		{ key: 'code', label: 'Code', required: true, helperText: 'Short machine code for formulas and API queries, e.g. DOmgL' },
		{ key: 'name', label: 'Name', required: true, helperText: 'Human label shown in the UI, e.g. Dissolved Oxygen' },
		{ key: 'default_units', label: 'Default Units', required: true, helperText: 'Measurement unit, e.g. uM, mg/L, NTU' },
		{ key: 'category', label: 'Category', type: 'select', defaultValue: 'measurement', helperText: 'Groups parameters in the UI and public API', options: [
			{ value: 'measurement', label: 'Measurement' },
			{ value: 'device_health', label: 'Device Health' },
		] },
		{ key: 'aliases', label: 'Aliases', type: 'tags', helperText: 'Alternative names that resolve to this parameter during CSV import and stream pairing' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'default_warning_min', label: 'Warning Min', type: 'number', step: 'any', helperText: 'Below this value triggers a warning (severity 1)' },
		{ key: 'default_warning_max', label: 'Warning Max', type: 'number', step: 'any', helperText: 'Above this value triggers a warning (severity 1)' },
		{ key: 'default_alarm_min', label: 'Alarm Min', type: 'number', step: 'any', helperText: 'Below this value triggers an alarm (severity 2)' },
		{ key: 'default_alarm_max', label: 'Alarm Max', type: 'number', step: 'any', helperText: 'Above this value triggers an alarm (severity 2)' },
	]}
/>
