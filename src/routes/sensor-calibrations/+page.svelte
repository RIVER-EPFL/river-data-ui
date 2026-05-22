<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api, type Sensor } from '$api/crud';
	import { formatDateTime } from '$lib/utils';

	let sensorMap = $state<Map<string, string>>(new Map());

	onMount(async () => {
		const sensors = await api.sensors.list({ perPage: 500 });
		sensorMap = new Map(sensors.data.map((s: Sensor) => [s.id, s.name ?? s.serial_number ?? s.id]));
	});
</script>

<svelte:head><title>Sensor Calibrations | River Data</title></svelte:head>

<CrudList
	client={api.sensorCalibrations}
	title="Sensor Calibrations"
	createHref="{base}/sensor-calibrations/new"
	columns={[
		{ key: 'sensor_id', label: 'Sensor', render: (_, row) => sensorMap.get(row.sensor_id) ?? '—' },
		{ key: 'valid_from', label: 'Valid From', render: (v) => v ? formatDateTime(v as string) : '—' },
		{ key: 'valid_until', label: 'Valid Until', render: (v) => v ? formatDateTime(v as string) : 'Open' },
		{ key: 'slope', label: 'Slope' },
		{ key: 'intercept', label: 'Intercept' },
	]}
	rowHref={(row) => `${base}/sensor-calibrations/${row.id}`}
/>
