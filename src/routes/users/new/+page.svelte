<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { searchDirectoryUsers, assignUserRoles, type DirectoryUser } from '$api/service';
	import { accessRoles, roleLabel, roleBadgeVariant } from '$lib/users';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let query = $state('');
	let results = $state<DirectoryUser[]>([]);
	let searching = $state(false);
	let searched = $state(false);
	let error = $state('');
	let addingId = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	function onInput() {
		clearTimeout(debounceTimer);
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			searched = false;
			return;
		}
		debounceTimer = setTimeout(() => search(q), 300);
	}

	async function search(q: string) {
		searching = true;
		error = '';
		try {
			results = await searchDirectoryUsers(q);
			searched = true;
		} catch (e) {
			results = [];
			error = e instanceof Error ? e.message : String(e);
		} finally {
			searching = false;
		}
	}

	function hasAccess(user: DirectoryUser): boolean {
		return accessRoles(user.roles).length > 0;
	}

	async function addUser(user: DirectoryUser) {
		addingId = user.id;
		try {
			await assignUserRoles(user.id, [...user.roles, 'riverdata-river']);
			toastStore.success(`${user.username} can now access River Data`);
			goto(`${base}/users/${user.id}`);
		} catch {
			toastStore.error('Failed to grant access');
		} finally {
			addingId = '';
		}
	}
</script>

<svelte:head><title>Add User | River Data</title></svelte:head>

<div class="space-y-4 max-w-3xl">
	<a href="{base}/users" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Users</a>
	<h2 class="text-xl font-semibold">Add User</h2>
	<p class="text-sm text-brand-muted">
		Search the directory for an existing account and grant it access. Accounts are managed
		centrally, so users are not created here.
	</p>

	<!-- svelte-ignore a11y_autofocus -->
	<input
		type="text"
		placeholder="Search by name, username or email…"
		autofocus
		bind:value={query}
		oninput={onInput}
		class="w-full max-w-md px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
	/>

	{#if error}
		<ErrorNotice message="Search failed: {error}" />
	{:else if searching}
		<p class="text-sm text-brand-muted">Searching…</p>
	{:else if searched && results.length === 0}
		<p class="text-sm text-brand-muted">No accounts match "{query.trim()}".</p>
	{:else if results.length > 0}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Name</th>
						<th class="text-left px-4 py-2 font-semibold">Username</th>
						<th class="text-left px-4 py-2 font-semibold">Email</th>
						<th class="text-left px-4 py-2 font-semibold">Access</th>
						<th class="px-4 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each results as user (user.id)}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="px-4 py-2">{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'None'}</td>
							<td class="px-4 py-2">{user.username}</td>
							<td class="px-4 py-2 text-brand-muted">{user.email ?? 'None'}</td>
							<td class="px-4 py-2">
								{#if hasAccess(user)}
									<div class="flex gap-1">
										{#each accessRoles(user.roles) as role}
											<Badge variant={roleBadgeVariant(role)}>{roleLabel(role)}</Badge>
										{/each}
									</div>
								{:else}
									<Badge variant="muted">No access</Badge>
								{/if}
							</td>
							<td class="px-4 py-2 text-right">
								{#if hasAccess(user)}
									<a href="{base}/users/{user.id}" class="text-sm text-brand-primary no-underline hover:underline">View</a>
								{:else}
									<Button variant="primary" size="sm" loading={addingId === user.id} onclick={() => addUser(user)}>
										Add
									</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
