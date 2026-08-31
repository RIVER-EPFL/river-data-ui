<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let sensorOptions = $state<Array<{ value: string; label: string }>>([]);
	let siteOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [sensors, sites] = await Promise.all([
			api.sensors.list({ perPage: 500 }),
			api.sites.list({ perPage: 200 }),
		]);
		sensorOptions = sensors.data.map((s) => ({ value: s.id, label: s.name ?? s.serial_number ?? s.id }));
		siteOptions = sites.data.map((s) => ({ value: s.id, label: s.name }));
	});

	const fields: Field[] = $derived([
		{ key: 'sensor_id', label: 'Sensor', type: 'select', required: true, options: sensorOptions },
		{ key: 'site_id', label: 'Site', type: 'select', required: true, options: siteOptions },
		{ key: 'deployed_from', label: 'Deployed From', type: 'datetime', required: true, helperText: 'When the sensor was installed at this site' },
		{ key: 'deployed_until', label: 'Deployed Until', type: 'datetime', helperText: 'When removed, auto-set on next deployment' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
	]);
</script>

<svelte:head><title>New Deployment | RIVER Data</title></svelte:head>

<CrudForm client={api.sensorDeployments} title="New Sensor Deployment" backHref="{base}/sensor-deployments" {fields} />
