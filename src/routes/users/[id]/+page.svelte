<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { crudClient, api, type Project } from '$api/crud';
	import { assignUserRoles, getUserGrants, setUserGrants } from '$api/service';
	import { accessRoles, roleLabel, roleBadgeVariant } from '$lib/users';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface User { id: string; username: string; email: string; firstName: string; lastName: string; enabled: boolean; roles?: string[]; }
	const usersClient = crudClient<User>('users');

	// The four ordered access levels; highest held wins.
	const LEVELS = [
		{ role: 'riverdata-intern', label: 'Intern', hint: 'Read-only access to data and charts.' },
		{ role: 'riverdata-river', label: 'River', hint: 'Write data and field metadata within granted projects.' },
		{ role: 'riverdata-manager', label: 'Manager', hint: 'Manage sensors and the catalog, plus everything River can do.' },
		{ role: 'riverdata-admin', label: 'Administrator', hint: 'Full access: users, tokens, onboarding, all projects.' },
	];
	const LEVEL_ROLES = LEVELS.map((l) => l.role);

	let user = $state<User | null>(null);
	let loading = $state(true);
	let error = $state('');
	let revoking = $state(false);
	let savingRole = $state(false);

	let projects = $state<Project[]>([]);
	let grantedIds = $state<Set<string>>(new Set());
	let savingGrants = $state(false);

	const userId = page.params.id!;
	const fullName = $derived([user?.firstName, user?.lastName].filter(Boolean).join(' '));
	const currentLevel = $derived.by(() => {
		const roles = user?.roles ?? [];
		for (let i = LEVELS.length - 1; i >= 0; i--) {
			if (roles.includes(LEVELS[i].role)) return LEVELS[i].role;
		}
		return '';
	});
	const isAdminLevel = $derived(currentLevel === 'riverdata-admin');

	onMount(async () => {
		try {
			user = await usersClient.get(userId);
			const [projRes, grants] = await Promise.all([
				api.projects.list({ perPage: 1000, sort: ['name', 'ASC'] }),
				getUserGrants(userId),
			]);
			projects = projRes.data;
			grantedIds = new Set(grants.map((g) => g.project_id));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

	async function setLevel(role: string) {
		if (!user || role === currentLevel) return;
		savingRole = true;
		try {
			const kept = (user.roles ?? []).filter((r) => !LEVEL_ROLES.includes(r));
			const newRoles = [...kept, role];
			await assignUserRoles(userId, newRoles);
			user = { ...user, roles: newRoles };
			toastStore.success(`Access level set to ${roleLabel(role)}`);
		} catch (e) {
			toastStore.error(`Failed to update access level: ${e instanceof Error ? e.message : e}`);
		} finally {
			savingRole = false;
		}
	}

	function toggleGrant(projectId: string) {
		const next = new Set(grantedIds);
		if (next.has(projectId)) next.delete(projectId);
		else next.add(projectId);
		grantedIds = next;
	}

	async function saveGrants() {
		savingGrants = true;
		try {
			await setUserGrants(userId, [...grantedIds]);
			toastStore.success('Project access saved');
		} catch (e) {
			toastStore.error(`Failed to save project access: ${e instanceof Error ? e.message : e}`);
		} finally {
			savingGrants = false;
		}
	}

	async function revokeAccess() {
		if (!user) return;
		if (!confirm(`Remove all River Data access for ${user.username}? Their account stays in the directory (it is not deleted), but they will no longer appear in this Users list until access is granted again.`)) return;
		revoking = true;
		try {
			await assignUserRoles(userId, (user.roles ?? []).filter((r) => !r.startsWith('riverdata-')));
			toastStore.success(`Access revoked for ${user.username}`);
			goto(`${base}/users`);
		} catch (e) {
			toastStore.error(`Failed to revoke access: ${e instanceof Error ? e.message : e}`);
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

		<div class="rounded-md border border-brand-divider bg-brand-surface">
			<div class="p-4 border-b border-brand-divider">
				<p class="text-sm font-medium">Access level</p>
				<p class="text-sm text-brand-muted">Capability comes from the level; projects below control what they see.</p>
			</div>
			<div class="divide-y divide-brand-divider">
				{#each LEVELS as level}
					<label class="flex items-center justify-between gap-4 p-4 cursor-pointer">
						<div>
							<p class="text-sm font-medium">{level.label}</p>
							<p class="text-sm text-brand-muted">{level.hint}</p>
						</div>
						<input
							type="radio"
							name="access-level"
							class="w-4 h-4"
							checked={currentLevel === level.role}
							disabled={savingRole}
							onchange={() => setLevel(level.role)}
						/>
					</label>
				{/each}
			</div>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface">
			<div class="p-4 border-b border-brand-divider flex items-center justify-between gap-4">
				<div>
					<p class="text-sm font-medium">Project access</p>
					<p class="text-sm text-brand-muted">Which projects this user may see and act in.</p>
				</div>
				{#if !isAdminLevel}
					<Button loading={savingGrants} onclick={saveGrants}>Save</Button>
				{/if}
			</div>
			{#if isAdminLevel}
				<p class="p-4 text-sm text-brand-muted">Administrators see every project, so no grants are needed.</p>
			{:else if projects.length === 0}
				<p class="p-4 text-sm text-brand-muted">No projects exist yet.</p>
			{:else}
				<div class="divide-y divide-brand-divider">
					{#each projects as project}
						<label class="flex items-center gap-3 p-4 cursor-pointer">
							<input
								type="checkbox"
								class="w-4 h-4"
								checked={grantedIds.has(project.id)}
								onchange={() => toggleGrant(project.id)}
							/>
							<span class="text-sm">{project.name}</span>
						</label>
					{/each}
				</div>
			{/if}
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface">
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
