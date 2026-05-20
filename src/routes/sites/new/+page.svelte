<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api, type Project } from '$api/crud';
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
		{ key: 'public_slug', label: 'Public API Slug', helperText: 'URL-safe slug for public API access (e.g. "les_dailles")' },
	]);
</script>

<svelte:head><title>New Site | River Data</title></svelte:head>

<CrudForm client={api.sites} title="New Site" backHref="{base}/sites" {fields} />
