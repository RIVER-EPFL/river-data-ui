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
		{ key: 'is_public', label: 'Public API', type: 'boolean', helperText: 'Enable public API access' },
		{ key: 'public_slug', label: 'Public API Slug', helperText: 'URL-safe slug, e.g. "mountresilience"' },
		{ key: 'public_api_title', label: 'API Title', helperText: 'Title shown in API documentation' },
		{ key: 'public_api_description', label: 'API Description', type: 'textarea', helperText: 'Description shown in API documentation (supports markdown)' },
		{ key: 'public_api_version', label: 'API Version', helperText: 'Version string for API docs (e.g. "1.0.0")' },
		{ key: 'public_contact_email', label: 'Contact Email', helperText: 'Contact email shown in API docs' },
	]}
/>
