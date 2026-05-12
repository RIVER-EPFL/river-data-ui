<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let projectOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const result = await api.projects.list({ perPage: 100 });
		projectOptions = result.data.map((p) => ({ value: p.id, label: p.name }));
	});

	const fields: Field[] = $derived([
		{ key: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions },
		{ key: 'name', label: 'Name', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'latitude', label: 'Latitude', type: 'number', step: 'any' },
		{ key: 'longitude', label: 'Longitude', type: 'number', step: 'any' },
		{ key: 'altitude_m', label: 'Altitude (m)', type: 'number', step: 'any' },
	]);
</script>

<svelte:head><title>Edit Site | River Data</title></svelte:head>

<CrudForm client={api.sites} entityId={page.params.id} title="Edit Site" backHref="{base}/sites/{page.params.id}" {fields} />
