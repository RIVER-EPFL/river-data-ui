<script lang="ts">
	import { base } from '$app/paths';
	import CrudList from '$components/crud/CrudList.svelte';
	import { crudClient } from '$api/crud';
	import { accessLevelLabel } from '$lib/users';

	interface User { id: string; username: string; email: string; firstName: string; lastName: string; enabled: boolean; roles?: string[]; createdTimestamp?: number; }
	const usersClient = crudClient<User>('users');
</script>

<svelte:head><title>Users | River Data</title></svelte:head>

<CrudList
	client={usersClient}
	title="Users"
	createHref="{base}/users/new"
	createLabel="Add User"
	columns={[
		{ key: 'username', label: 'Username' },
		{ key: 'email', label: 'Email', class: 'text-brand-muted' },
		{ key: 'firstName', label: 'First Name' },
		{ key: 'lastName', label: 'Last Name' },
		{ key: 'enabled', label: 'Enabled', render: (v) => v ? '✓' : 'None' },
		{ key: 'roles', label: 'Role', sortable: false, render: (v) => accessLevelLabel(v as string[]) },
	]}
	rowHref={(row) => `${base}/users/${row.id}`}
/>
