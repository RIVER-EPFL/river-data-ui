<script lang="ts">
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api } from '$api/crud';
</script>

<svelte:head><title>Constants | River Data</title></svelte:head>

<CrudList
	client={api.constants}
	title="Constants"
	createHref="{base}/constants/new"
	searchable
	columns={[
		{ key: 'name', label: 'Name' },
		{ key: 'value', label: 'Value' },
		{ key: 'units', label: 'Units' },
		{ key: 'description', label: 'Description', class: 'text-brand-muted' },
	]}
	rowHref={(row) => `${base}/constants/${row.id}`}
/>
