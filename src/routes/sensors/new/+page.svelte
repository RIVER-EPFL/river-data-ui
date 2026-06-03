<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api, type Parameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';

	let parameters = $state<Parameter[]>([]);

	$effect(() => {
		api.parameters
			.list({ perPage: 1000, sort: ['code', 'ASC'] })
			.then((res) => {
				parameters = res.data;
			})
			.catch((e) => toastStore.error(`Failed to load parameters: ${e.message}`));
	});
</script>

<svelte:head><title>New Sensor | River Data</title></svelte:head>

<!--
	A sensor measures exactly one global parameter (parameter_id is NOT NULL). A multi-parameter
	probe is registered as one sensor per parameter, sharing the serial number.
-->
<CrudForm
	client={api.sensors}
	title="New Sensor"
	backHref="{base}/sensors"
	fields={[
		{
			key: 'parameter_id',
			label: 'Parameter',
			type: 'select',
			required: true,
			options: parameters.map((p) => ({
				value: p.id,
				label: `${p.code} — ${p.name}${p.default_units ? ` (${p.default_units})` : ''}`,
			})),
			helperText: 'The quantity this sensor measures. Need a new one? Create it under Parameters first.',
		},
		{ key: 'serial_number', label: 'Serial Number', helperText: 'Device serial — the physical-instrument identity (unique per parameter)' },
		{ key: 'name', label: 'Name' },
		{ key: 'manufacturer', label: 'Manufacturer' },
		{ key: 'model', label: 'Model' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
		{ key: 'is_lab_instrument', label: 'Lab instrument', type: 'boolean', defaultValue: false, helperText: 'Field/lab instrument taken on trips (sparse grab samples) rather than a fixed station sensor' },
		{ key: 'is_active', label: 'Active', type: 'boolean', defaultValue: true, helperText: 'Inactive sensors are hidden from deployment dropdowns' },
	]}
/>
