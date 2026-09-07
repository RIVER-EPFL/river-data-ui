<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type RealmUser } from '$api/crud';
	import { getNotificationSubscribers } from '$api/service';
	import { accessLevelLabel, accessLevelVariant, highestAccessRole } from '$lib/users';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import TokensPanel from '$components/tokens/TokensPanel.svelte';

	// A bare ?show=<id> (from the audit-log deep link, before /tokens redirected here) means the
	// caller wants a specific token, so open on the Tokens tab.
	const initialTab = page.url.searchParams.has('show') && !page.url.searchParams.has('tab')
		? 'tokens'
		: undefined;
	const tab = createUrlTab({ keys: ['users', 'tokens'], initial: initialTab });

	type User = RealmUser;

	let all = $state<User[]>([]);
	// Push subscription count per Keycloak sub.
	let pushCounts = $state(new Map<string, number>());
	let search = $state('');
	// null = All; otherwise a `riverdata-*` role key, or '' for No access.
	let roleFilter = $state<string | null>(null);

	// The filter chips, in level order. `key` matches `highestAccessRole` output ('' = no access).
	const FILTERS: { key: string | null; label: string }[] = [
		{ key: null, label: 'All' },
		{ key: 'riverdata-admin', label: 'Administrator' },
		{ key: 'riverdata-manager', label: 'Manager' },
		{ key: 'riverdata-river', label: 'River' },
		{ key: 'riverdata-intern', label: 'Intern' },
		{ key: '', label: 'No access' },
	];

	const columns: Column[] = [
		{ key: 'username', label: 'Username' },
		{ key: 'email', label: 'Email', class: 'text-brand-muted' },
		{ key: 'name', label: 'Name', sortable: false },
		{ key: 'role', label: 'Role', sortable: false },
		{ key: 'push', label: 'Push', sortable: false },
		{ key: 'enabled', label: 'Enabled', sortable: false },
	];

	function levelKey(u: User): string {
		return highestAccessRole(u.roles) ?? '';
	}

	function count(key: string | null): number {
		if (key === null) return all.length;
		return all.filter((u) => levelKey(u) === key).length;
	}

	const matching = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return all.filter((u) => {
			if (roleFilter !== null && levelKey(u) !== roleFilter) return false;
			if (!q) return true;
			return (
				u.username?.toLowerCase().includes(q) ||
				u.email?.toLowerCase().includes(q) ||
				`${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q)
			);
		});
	});

	// The realm is listed once and the push roster joined onto it; the chips and the search then
	// narrow what is already loaded, which is what keeps the per-level counts honest.
	async function loadUsers({ sort }: PageRequest) {
		if (all.length === 0) {
			const [result, roster] = await Promise.all([
				api.users.list({ perPage: 500, sort }),
				getNotificationSubscribers().catch(() => []),
			]);
			all = result.data;
			pushCounts = new Map(roster.map((s) => [s.keycloakSub, s.pushSubscriptionCount]));
		}
		return { data: matching, total: matching.length };
	}

	function devices(u: User): number {
		return pushCounts.get(u.id) ?? 0;
	}
</script>

<svelte:head><title>Users &amp; Tokens | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Users &amp; Tokens</h2>
		{#if tab.key === 'users'}
			<a
				href="{base}/users/new"
				class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark"
			>
				Add User
			</a>
		{/if}
	</div>

	<Tabs tabs={['Users', 'Tokens']} bind:active={tab.index} />

	{#if tab.key === 'tokens'}
		<TokensPanel />
	{:else}
		<CrudList
			load={loadUsers}
			{columns}
			title="Users"
			showHeader={false}
			perPage={500}
			defaultSort={['username', 'ASC']}
			emptyText="No users found"
			rowHref={(u: User) => `${base}/users/${u.id}`}
		>
			{#snippet filterBar({ reload }: { reload: () => void })}
				<input
					type="text"
					placeholder="Search…"
					bind:value={search}
					oninput={reload}
					class="w-full max-w-xs px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
				/>
				<div class="flex flex-wrap gap-1.5">
					{#each FILTERS as f}
						<button
							type="button"
							onclick={() => { roleFilter = f.key; reload(); }}
							class="px-2.5 py-1 text-xs font-medium rounded-full border transition-colors {roleFilter === f.key
								? 'bg-brand-primary text-white border-brand-primary'
								: 'bg-brand-surface text-brand-muted border-brand-divider hover:text-brand-text'}"
						>
							{f.label} ({count(f.key)})
						</button>
					{/each}
				</div>
			{/snippet}

			{#snippet cell({ column, row, text }: { column: Column; row: User; text: string })}
				{#if column.key === 'name'}
					{[row.firstName, row.lastName].filter(Boolean).join(' ') || '-'}
				{:else if column.key === 'email'}
					{row.email || '-'}
				{:else if column.key === 'role'}
					<Badge variant={accessLevelVariant(row.roles)}>{accessLevelLabel(row.roles)}</Badge>
				{:else if column.key === 'push'}
					<Badge variant={devices(row) ? 'ok' : 'muted'}>
						{devices(row)} device{devices(row) === 1 ? '' : 's'}
					</Badge>
				{:else if column.key === 'enabled'}
					{row.enabled ? '✓' : 'None'}
				{:else}
					{text}
				{/if}
			{/snippet}

			{#snippet footer()}
				{matching.length} of {all.length} users
			{/snippet}
		</CrudList>
	{/if}
</div>
