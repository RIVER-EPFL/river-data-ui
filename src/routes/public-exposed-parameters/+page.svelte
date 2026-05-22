<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api, type Project, type Parameter } from '$api/crud';

	let projectMap = $state<Map<string, string>>(new Map());
	let paramMap = $state<Map<string, string>>(new Map());

	onMount(async () => {
		const [projects, params] = await Promise.all([
			api.projects.list({ perPage: 100 }),
			api.parameters.list({ perPage: 500 }),
		]);
		projectMap = new Map(projects.data.map((p: Project) => [p.id, p.name]));
		paramMap = new Map(params.data.map((p: Parameter) => [p.id, p.display_name]));
	});
</script>

<svelte:head><title>Public Exposed Parameters | River Data</title></svelte:head>

<CrudList
	client={api.publicExposedParameters}
	title="Public Exposed Parameters"
	createHref="{base}/public-exposed-parameters/new"
	columns={[
		{ key: 'project_id', label: 'Project', render: (_, row) => projectMap.get(row.project_id) ?? '—' },
		{ key: 'parameter_id', label: 'Parameter', render: (_, row) => paramMap.get(row.parameter_id) ?? '—' },
		{ key: 'public_name', label: 'Public Name' },
		{ key: 'public_units', label: 'Units' },
		{ key: 'sort_order', label: 'Order' },
		{ key: 'include_derived', label: 'Derived', render: (v) => v ? 'Yes' : '' },
	]}
	rowHref={(row) => `${base}/public-exposed-parameters/${row.id}`}
/>
