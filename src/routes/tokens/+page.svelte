<script lang="ts">
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { api } from '$api/crud';

	function formatPermissions(perms: unknown): string {
		if (!Array.isArray(perms)) return '—';
		return perms.map((p: string) => p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
	}
</script>

<svelte:head><title>API Tokens | River Data</title></svelte:head>

<CrudList
	client={api.apiTokens}
	title="API Tokens"
	createHref="{base}/tokens/new"
	columns={[
		{ key: 'name', label: 'Name' },
		{ key: 'permissions', label: 'Permissions', sortable: false, render: formatPermissions },
		{ key: 'expires_at', label: 'Expires', render: (v) => v ? new Date(v as string).toLocaleDateString() : 'Never' },
		{ key: 'created_at', label: 'Created' },
	]}
/>
