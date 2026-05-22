<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
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
		{ key: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions, disabled: true },
		{ key: 'parameter_id', label: 'Parameter', type: 'select', required: true, options: paramOptions, disabled: true },
		{ key: 'public_name', label: 'Public Name', required: true },
		{ key: 'public_units', label: 'Public Units', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'sort_order', label: 'Sort Order', type: 'number' },
		{ key: 'conversion_factor', label: 'Conversion Factor', type: 'number', step: 'any' },
		{ key: 'conversion_offset', label: 'Conversion Offset', type: 'number', step: 'any' },
		{ key: 'include_derived', label: 'Include Derived', type: 'boolean' },
	]);
</script>

<svelte:head><title>Edit Public Exposed Parameter | River Data</title></svelte:head>

<CrudForm client={api.publicExposedParameters} entityId={page.params.id} title="Edit Public Exposed Parameter" backHref="{base}/public-exposed-parameters" {fields} />
