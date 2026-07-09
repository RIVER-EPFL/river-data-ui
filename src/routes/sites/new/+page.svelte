<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let projectOptions = $state<Array<{ value: string; label: string }>>([]);
	let subprojectOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [projects, subprojects] = await Promise.all([
			api.projects.list({ perPage: 100, sort: ['name', 'ASC'] }),
			api.subprojects.list({ perPage: 1000, sort: ['name', 'ASC'] }),
		]);
		projectOptions = projects.data.map((p) => ({ value: p.id, label: p.name }));
		const projectName = new Map(projects.data.map((p) => [p.id, p.name]));
		subprojectOptions = subprojects.data.map((s) => ({
			value: s.id,
			label: `${projectName.get(s.project_id) ?? '—'} — ${s.name}`,
		}));
	});

	const fields: Field[] = $derived([
		{ key: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions },
		{
			key: 'subproject_id',
			label: 'Subproject',
			type: 'select',
			options: subprojectOptions,
			helperText: 'Optional — defaults to the project’s main subproject.',
		},
		{ key: 'name', label: 'Name', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'latitude', label: 'Latitude', type: 'number', step: 'any', helperText: 'WGS84 coordinate' },
		{ key: 'longitude', label: 'Longitude', type: 'number', step: 'any', helperText: 'WGS84 coordinate' },
		{ key: 'altitude_m', label: 'Altitude (m)', type: 'number', step: 'any', helperText: 'Elevation in meters above sea level' },
		{ key: 'public_code', label: 'Public API Code', helperText: 'URL-safe code for public API access (e.g. "les_dailles")' },
	]);
</script>

<svelte:head><title>New Site | River Data</title></svelte:head>

<CrudForm client={api.sites} title="New Site" backHref="{base}/sites" {fields} />
