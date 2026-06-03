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
		paramMap = new Map(params.data.map((p: Parameter) => [p.id, p.name]));
	});
</script>

<svelte:head><title>Site Parameters | River Data</title></svelte:head>

<CrudList
	client={api.siteParameters}
	title="Site Parameters"
	createHref="{base}/site-parameters/new"
	columns={[
		{ key: 'site_id', label: 'Site', render: (_, row) => siteMap.get(row.site_id) ?? '—' },
		{ key: 'parameter_id', label: 'Parameter', render: (_, row) => paramMap.get(row.parameter_id) ?? '—' },
		{ key: 'display_units', label: 'Units' },
		{ key: 'sample_interval_sec', label: 'Interval (s)' },
		{ key: 'is_derived', label: 'Derived', render: (v) => v ? 'Yes' : '' },
		{ key: 'is_active', label: 'Active', render: (v) => v === false ? 'No' : 'Yes' },
	]}
	rowHref={(row) => `${base}/site-parameters/${row.id}`}
/>
