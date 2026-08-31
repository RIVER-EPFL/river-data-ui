<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
	import { siteNavigator } from '$lib/stores/sites.svelte';
</script>

<svelte:head><title>New Project | RIVER Data</title></svelte:head>

<CrudForm
	client={api.projects}
	title="New Project"
	backHref="{base}/projects"
	onSaved={() => void siteNavigator.refresh()}
	fields={[
		{ key: 'name', label: 'Name', required: true, helperText: 'Project name shown in the UI and API' },
		{ key: 'description', label: 'Description', type: 'textarea' },
		{ key: 'is_public', label: 'Public API', type: 'boolean', helperText: 'Enable the public read-only API for this project' },
		{ key: 'public_code', label: 'Public API Code', helperText: 'URL-safe identifier, e.g. breathe' },
		{ key: 'public_api_title', label: 'API Title', helperText: 'Title shown in API documentation' },
		{ key: 'public_api_description', label: 'API Description', type: 'textarea', helperText: 'Description shown in API documentation (supports markdown)' },
		{ key: 'public_api_version', label: 'API Version', helperText: 'Version string for the public API docs' },
		{ key: 'public_contact_email', label: 'Contact Email', helperText: 'Contact email shown in API docs' },
	]}
/>
