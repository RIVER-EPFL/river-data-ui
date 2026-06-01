<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let projectOptions = $state<Array<{ value: string; label: string }>>([]);
	let paramOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [projects, params] = await Promise.all([
			api.projects.list({ perPage: 100 }),
			api.parameters.list({ perPage: 500 }),
		]);
		projectOptions = projects.data.map((p) => ({ value: p.id, label: p.name }));
		paramOptions = params.data.map((p) => ({ value: p.id, label: p.display_name }));
	});

	const fields: Field[] = $derived([
		{ key: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions },
		{ key: 'public_name', label: 'Public Name', required: true, helperText: 'Column name in public API exports, e.g. DOuM' },
		{ key: 'public_units', label: 'Public Units', required: true, helperText: 'Units displayed in public API, may differ from internal' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'sort_order', label: 'Sort Order', type: 'number', defaultValue: 0, helperText: 'Display order in public API output (lower = first)' },
		{ key: 'conversion_factor', label: 'Conversion Factor', type: 'number', step: 'any', helperText: 'Multiply internal value by this factor for public output' },
		{ key: 'conversion_offset', label: 'Conversion Offset', type: 'number', step: 'any', helperText: 'Add this offset after applying the conversion factor' },
		{ key: 'include_derived', label: 'Include Derived', type: 'boolean', defaultValue: false, helperText: 'Include derived values for this parameter in public output' },
	]);
</script>

<svelte:head><title>New Public Exposed Parameter | River Data</title></svelte:head>

<CrudForm client={api.publicExposedParameters} title="New Public Exposed Parameter" backHref="{base}/public-exposed-parameters" {fields} />
