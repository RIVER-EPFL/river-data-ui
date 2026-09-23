<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { listAll } from '$api/paged';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import MeteoswissSubscriptions from '$components/sites/MeteoswissSubscriptions.svelte';
	import { api } from '$api/crud';
	import { siteNavigator } from '$lib/stores/sites.svelte';
	import type { Field } from '$components/crud/CrudForm.svelte';

	let projectOptions = $state<Array<{ value: string; label: string }>>([]);
	let subprojectOptions = $state<Array<{ value: string; label: string }>>([]);

	onMount(async () => {
		const [projects, subprojects] = await Promise.all([
			listAll(api.projects, { sort: ['name', 'ASC'] }),
			listAll(api.subprojects, { sort: ['name', 'ASC'] }),
		]);
		projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
		const projectName = new Map(projects.map((p) => [p.id, p.name]));
		subprojectOptions = subprojects.map((s) => ({
			value: s.id,
			label: `${projectName.get(s.project_id) ?? '-'} - ${s.name}`,
		}));
	});

	const fields: Field[] = $derived([
		{ key: 'project_id', label: 'Project', type: 'select', required: true, options: projectOptions },
		{
			key: 'subproject_id',
			label: 'Subproject',
			type: 'select',
			options: subprojectOptions,
			helperText: 'Moving to a subproject in another project reassigns the site’s project.',
		},
		{ key: 'name', label: 'Name', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'latitude', label: 'Latitude', type: 'number', step: 'any', helperText: 'WGS84 coordinate' },
		{ key: 'longitude', label: 'Longitude', type: 'number', step: 'any', helperText: 'WGS84 coordinate' },
		{ key: 'altitude_m', label: 'Altitude (m)', type: 'number', step: 'any', helperText: 'Elevation in meters above sea level' },
		{ key: 'public_code', label: 'Public API Code', helperText: 'URL-safe code for public API access (e.g. "les_dailles")' },
	]);
</script>

<svelte:head><title>Edit Site | RIVER Data</title></svelte:head>

<CrudForm client={api.sites} entityId={page.params.id} title="Edit Site" backHref="{base}/sites/{page.params.id}" {fields} onSaved={() => void siteNavigator.refresh()} />

<!-- A subscription is its own row rather than a column on the site, so it is attached here and
     saved on the spot rather than with the form. The create form has no site to attach one to. -->
{#if page.params.id}
	<div class="mt-6 rounded border border-brand-border p-4">
		<MeteoswissSubscriptions siteId={page.params.id} />
	</div>
{/if}
