<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { crudClient } from '$api/crud';
	import { assignUserRoles } from '$api/service';
	import { accessRoles, roleLabel, roleBadgeVariant } from '$lib/users';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface User { id: string; username: string; email: string; firstName: string; lastName: string; enabled: boolean; roles?: string[]; }
	const usersClient = crudClient<User>('users');

	let user = $state<User | null>(null);
	let loading = $state(true);
	let error = $state('');
	let revoking = $state(false);

	const userId = page.params.id!;
	const isAdmin = $derived(user?.roles?.includes('riverdata-admin') ?? false);
	const fullName = $derived([user?.firstName, user?.lastName].filter(Boolean).join(' '));

	onMount(async () => {
		try {
			user = await usersClient.get(userId);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

	async function toggleAdmin() {
		if (!user) return;
		try {
			const newRoles = isAdmin
				? (user.roles ?? []).filter((r) => r !== 'riverdata-admin')
				: [...(user.roles ?? []), 'riverdata-admin'];
			await assignUserRoles(userId, newRoles);
			user = { ...user, roles: newRoles };
			toastStore.success(isAdmin ? 'Administrator access removed' : 'Administrator access granted');
		} catch { toastStore.error('Failed to update roles'); }
	}

	async function revokeAccess() {
		if (!user) return;
		if (!confirm(`Remove all River Data access for ${user.username}? Their account is not deleted.`)) return;
		revoking = true;
		try {
			await assignUserRoles(userId, (user.roles ?? []).filter((r) => !r.startsWith('riverdata-')));
			toastStore.success(`Access revoked for ${user.username}`);
			goto(`${base}/users`);
		} catch {
			toastStore.error('Failed to revoke access');
		} finally {
			revoking = false;
		}
	}
</script>

<svelte:head><title>{user?.username ?? 'User'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading…</p>
{:else if error}
	<div class="space-y-4 max-w-xl">
		<a href="{base}/users" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Users</a>
		<ErrorNotice message="Failed to load user: {error}" />
	</div>
{:else if user}
	<div class="space-y-4 max-w-xl">
		<a href="{base}/users" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Users</a>

		<div class="flex items-center justify-between gap-4">
			<div>
				<h2 class="text-xl font-semibold">{fullName || user.username}</h2>
				<p class="text-sm text-brand-muted">{user.username}{user.email ? ` · ${user.email}` : ''}</p>
			</div>
			<div class="flex gap-1.5">
				{#if !user.enabled}
					<Badge variant="muted">Disabled</Badge>
				{/if}
				{#each accessRoles(user.roles) as role}
					<Badge variant={roleBadgeVariant(role)}>{roleLabel(role)}</Badge>
				{:else}
					<Badge variant="muted">No access</Badge>
				{/each}
			</div>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface divide-y divide-brand-divider">
			<div class="flex items-center justify-between gap-4 p-4">
				<div>
					<p class="text-sm font-medium">Administrator</p>
					<p class="text-sm text-brand-muted">Can manage users, sensors, tokens and project configuration.</p>
				</div>
				<label class="inline-flex items-center cursor-pointer">
					<input type="checkbox" checked={isAdmin} onchange={toggleAdmin} class="w-4 h-4" />
				</label>
			</div>
			<div class="flex items-center justify-between gap-4 p-4">
				<div>
					<p class="text-sm font-medium">Revoke access</p>
					<p class="text-sm text-brand-muted">Removes River Data access. The account stays in the directory.</p>
				</div>
				<Button variant="danger" loading={revoking} onclick={revokeAccess}>Revoke</Button>
			</div>
		</div>
	</div>
{/if}
