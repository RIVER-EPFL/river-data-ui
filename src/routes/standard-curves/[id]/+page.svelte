<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api, type Parameter } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let paramOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const result = await api.parameters.list({ perPage: 500 });
		paramOptions = result.data.map((p) => ({ value: p.id, label: p.name }));
	});

	const fields: Field[] = $derived([
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions },
		{ key: 'valid_from', label: 'Valid From', type: 'datetime', required: true },
		{ key: 'slope', label: 'Slope', type: 'number', required: true, step: 'any', helperText: 'Reference curve slope' },
		{ key: 'intercept', label: 'Intercept', type: 'number', required: true, step: 'any', helperText: 'Reference curve intercept' },
		{ key: 'r_squared', label: 'R²', type: 'number', step: 'any', helperText: 'Coefficient of determination (0-1)' },
		{ key: 'notes', label: 'Notes', type: 'textarea' },
	]);
</script>

<svelte:head><title>Edit Standard Curve | River Data</title></svelte:head>

<CrudForm client={api.standardCurves} entityId={page.params.id} title="Edit Standard Curve" backHref="{base}/standard-curves" {fields} />
