<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let sensorOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const sensors = await api.sensors.list({ perPage: 500 });
		sensorOptions = sensors.data.map((s) => ({ value: s.id, label: s.name ?? s.serial_number ?? s.id }));
	});

	const fields: Field[] = $derived([
		{ key: 'sensor_id', label: 'Sensor', type: 'select', required: true, options: sensorOptions, disabled: true },
		{ key: 'valid_from', label: 'Valid From', type: 'datetime', required: true },
		{ key: 'valid_until', label: 'Valid Until', type: 'datetime' },
		{ key: 'slope', label: 'Slope (m)', type: 'number', required: true, step: 'any' },
		{ key: 'intercept', label: 'Intercept (b)', type: 'number', required: true, step: 'any' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
	]);
</script>

<svelte:head><title>Edit Calibration | River Data</title></svelte:head>

<CrudForm client={api.sensorCalibrations} entityId={page.params.id} title="Edit Sensor Calibration" backHref="{base}/sensor-calibrations" {fields} />
