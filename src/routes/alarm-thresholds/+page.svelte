<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api, type Site, type Parameter } from '$api/crud';

	let siteMap = $state<Map<string, string>>(new Map());
	let paramMap = $state<Map<string, string>>(new Map());

	onMount(async () => {
		const [sites, params] = await Promise.all([
			api.sites.list({ perPage: 200 }),
			api.parameters.list({ perPage: 500 }),
		]);
		siteMap = new Map(sites.data.map((s: Site) => [s.id, s.name]));
		paramMap = new Map(params.data.map((p: Parameter) => [p.id, p.display_name]));
	});
</script>

<svelte:head><title>Alarm Thresholds | River Data</title></svelte:head>

<CrudList
	client={api.alarmThresholds}
	title="Alarm Thresholds"
	createHref="{base}/alarm-thresholds/new"
	columns={[
		{ key: 'parameter_id', label: 'Parameter', render: (_, row) => paramMap.get(row.parameter_id) ?? '—' },
		{ key: 'site_id', label: 'Site', render: (_, row) => row.site_id ? siteMap.get(row.site_id) ?? '—' : 'Global default' },
		{ key: 'alarm_type', label: 'Type' },
		{ key: 'warning_min', label: 'W Min' },
		{ key: 'warning_max', label: 'W Max' },
		{ key: 'alarm_min', label: 'A Min' },
		{ key: 'alarm_max', label: 'A Max' },
	]}
	rowHref={(row) => `${base}/alarm-thresholds/${row.id}`}
/>
