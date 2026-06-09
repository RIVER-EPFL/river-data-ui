<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { crudClient } from '$api/crud';
	import { listRoles, assignUserRoles } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface User { id: string; username: string; email: string; firstName: string; lastName: string; enabled: boolean; roles?: string[]; }
	const usersClient = crudClient<User>('users');

	let user = $state<User | null>(null);
	let loading = $state(true);

	const userId = page.params.id!;
	const isAdmin = $derived(user?.roles?.includes('admin') ?? false);

	onMount(async () => {
		try { user = await usersClient.get(userId); }
		finally { loading = false; }
	});

	async function toggleAdmin() {
		if (!user) return;
		try {
			const newRoles = isAdmin
				? (user.roles ?? []).filter((r) => r !== 'admin')
				: [...(user.roles ?? []), 'admin'];
			await assignUserRoles(userId, newRoles);
			user = { ...user, roles: newRoles };
			toastStore.success(isAdmin ? 'Admin role removed' : 'Admin role granted');
		} catch { toastStore.error('Failed to update roles'); }
	}
</script>

<svelte:head><title>{user?.username ?? 'User'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if user}
	<div class="space-y-4 max-w-xl">
		<a href="{base}/users" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Users</a>
		<h2 class="text-xl font-semibold">{user.username}</h2>

		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div><span class="text-brand-muted block">Email</span>{user.email ?? 'None'}</div>
				<div><span class="text-brand-muted block">Name</span>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'None'}</div>
				<div><span class="text-brand-muted block">Enabled</span>{user.enabled ? 'Yes' : 'No'}</div>
				<div>
					<span class="text-brand-muted block">Roles</span>
					<div class="flex gap-1 mt-0.5">
						{#each user.roles ?? [] as role}
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-primary/10 text-brand-primary">{role}</span>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface p-4">
			<label class="flex items-center gap-3 cursor-pointer">
				<input type="checkbox" checked={isAdmin} onchange={toggleAdmin} class="w-4 h-4" />
				<span class="text-sm font-medium">Admin</span>
			</label>
		</div>
	</div>
{/if}
