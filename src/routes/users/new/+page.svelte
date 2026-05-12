<script lang="ts">
	import { base } from '$app/paths';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import { crudClient } from '$api/crud';
	const usersClient = crudClient('users');
</script>

<svelte:head><title>New User | River Data</title></svelte:head>

<CrudForm
	client={usersClient}
	title="New User"
	backHref="{base}/users"
	fields={[
		{ key: 'username', label: 'Username', required: true },
		{ key: 'email', label: 'Email', type: 'email' },
		{ key: 'firstName', label: 'First Name' },
		{ key: 'lastName', label: 'Last Name' },
		{ key: 'password', label: 'Password', type: 'password', helperText: 'Initial password for the user' },
		{ key: 'enabled', label: 'Enabled', type: 'boolean', defaultValue: true, helperText: 'Account is active' },
	]}
/>
