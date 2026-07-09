<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let sensorOptions = $state<Array<{ value: string; label: string }>>([]);
	let parameterOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [sensors, parameters] = await Promise.all([
			api.sensors.list({ perPage: 500 }),
			api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] }),
		]);
		sensorOptions = sensors.data.map((s) => ({ value: s.id, label: s.name ?? s.serial_number ?? s.id }));
		parameterOptions = parameters.data.map((p) => ({ value: p.id, label: `${p.code} - ${p.name}` }));
	});

	const fields: Field[] = $derived([
		{ key: 'sensor_id', label: 'Sensor', type: 'select', required: true, options: sensorOptions },
		{ key: 'name', label: 'Name', helperText: 'Optional label for this curve' },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', options: parameterOptions, helperText: 'For windowed field-channel curves; leave blank for lab instruments' },
		{ key: 'valid_from', label: 'Valid From', type: 'datetime', required: true, helperText: 'Start of calibration validity period' },
		{ key: 'valid_until', label: 'Valid Until', type: 'datetime', helperText: 'End of validity, auto-set when a new calibration is created' },
		{ key: 'slope', label: 'Slope (m)', type: 'number', required: true, step: 'any', helperText: 'calibrated = slope * raw + intercept' },
		{ key: 'intercept', label: 'Intercept (b)', type: 'number', required: true, step: 'any', helperText: 'Linear calibration intercept' },
		{ key: 'r_squared', label: 'R²', type: 'number', step: 'any', helperText: 'Optional goodness-of-fit for the curve' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
	]);
</script>

<svelte:head><title>New Calibration | River Data</title></svelte:head>

<CrudForm client={api.sensorCalibrations} title="New Sensor Calibration" backHref="{base}/sensor-calibrations" {fields} />
