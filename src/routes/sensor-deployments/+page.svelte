<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api, type Sensor, type Site } from '$api/crud';
	import { formatDateTime } from '$lib/utils';

	let sensorMap = $state<Map<string, string>>(new Map());
	let siteMap = $state<Map<string, string>>(new Map());

	onMount(async () => {
		const [sensors, sites] = await Promise.all([
			api.sensors.list({ perPage: 500 }),
			api.sites.list({ perPage: 200 }),
		]);
		sensorMap = new Map(sensors.data.map((s: Sensor) => [s.id, s.name ?? s.serial_number ?? s.id]));
		siteMap = new Map(sites.data.map((s: Site) => [s.id, s.name]));
	});
</script>

<svelte:head><title>Sensor Deployments | River Data</title></svelte:head>

<CrudList
	client={api.sensorDeployments}
	title="Sensor Deployments"
	createHref="{base}/sensor-deployments/new"
	columns={[
		{ key: 'sensor_id', label: 'Sensor', render: (_, row) => sensorMap.get(row.sensor_id) ?? 'None' },
		{ key: 'site_id', label: 'Site', render: (_, row) => siteMap.get(row.site_id) ?? 'None' },
		{ key: 'deployed_from', label: 'From', render: (v) => v ? formatDateTime(v as string) : 'None' },
		{ key: 'deployed_until', label: 'Until', render: (v) => v ? formatDateTime(v as string) : 'Current' },
	]}
	rowHref={(row) => `${base}/sensor-deployments/${row.id}`}
/>
