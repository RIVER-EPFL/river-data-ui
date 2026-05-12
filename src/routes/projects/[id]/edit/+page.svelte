<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>Edit Project | River Data</title></svelte:head>

<CrudForm
	client={api.projects}
	entityId={page.params.id}
	title="Edit Project"
	backHref="{base}/projects/{page.params.id}"
	fields={[
		{ key: 'name', label: 'Name', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'public_api_enabled', label: 'Public API', type: 'boolean', helperText: 'Enable public API access' },
		{ key: 'public_api_slug', label: 'Public API Slug', helperText: 'URL-safe slug' },
	]}
/>
