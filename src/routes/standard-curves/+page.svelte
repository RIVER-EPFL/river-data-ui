<script lang="ts">
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api, type Parameter } from '$api/crud';
	import { onMount } from 'svelte';

	let params = $state<Parameter[]>([]);

	onMount(async () => {
		const result = await api.parameters.list({ perPage: 500 });
		params = result.data;
	});

	function paramName(val: unknown): string {
		if (!val) return '—';
		return params.find((p) => p.id === val)?.display_name ?? String(val);
	}

	function curveStatus(row: Record<string, unknown>): string {
		const from = row.valid_from ? new Date(row.valid_from as string).getTime() : 0;
		const until = row.valid_until ? new Date(row.valid_until as string).getTime() : Infinity;
		const now = Date.now();
		if (now < from) return 'Future';
		if (now > until) return 'Historical';
		return 'Current';
	}
</script>

<svelte:head><title>Standard Curves | River Data</title></svelte:head>

<CrudList
	client={api.standardCurves}
	title="Standard Curves"
	createHref="{base}/standard-curves/new"
	defaultSort={['valid_from', 'DESC']}
	columns={[
		{ key: '_status', label: 'Status', sortable: false, render: (_v, row) => curveStatus(row) },
		{ key: 'parameter_id', label: 'Parameter', sortable: false, render: (v) => paramName(v) },
		{ key: 'valid_from', label: 'Valid From' },
		{ key: 'slope', label: 'Slope' },
		{ key: 'intercept', label: 'Intercept' },
		{ key: 'r_squared', label: 'R²', render: (v) => v != null ? Number(v).toFixed(6) : '—' },
		{ key: '_equation', label: 'Equation', sortable: false, render: (_v, row) => `y = ${row.slope}x + ${row.intercept}` },
	]}
	rowHref={(row) => `${base}/standard-curves/${row.id}`}
/>
