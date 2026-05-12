<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>New Derived Parameter | River Data</title></svelte:head>

<CrudForm
	client={api.derivedParameters}
	title="New Derived Parameter"
	backHref="{base}/derived"
	fields={[
		{ key: 'name', label: 'Name', required: true },
		{ key: 'formula', label: 'Formula', required: true, helperText: 'meval expression, e.g. "depth * 0.001"' },
		{ key: 'description', label: 'Description', type: 'textarea' },
	]}
/>
