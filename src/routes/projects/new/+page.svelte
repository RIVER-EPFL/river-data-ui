<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Project | River Data</title></svelte:head>

<CrudForm
	client={api.projects}
	title="New Project"
	backHref="{base}/projects"
	fields={[
		{ key: 'name', label: 'Name', required: true },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'public_api_enabled', label: 'Public API', type: 'boolean', helperText: 'Enable public API access' },
		{ key: 'public_api_slug', label: 'Public API Slug', helperText: 'URL-safe slug, e.g. "mountresilience"' },
	]}
/>
