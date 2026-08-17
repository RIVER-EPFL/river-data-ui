<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, type RealmUser } from '$api/crud';
	import { getNotificationSubscribers } from '$api/service';
	import {
		accessLevelLabel,
		accessLevelVariant,
		highestAccessRole,
		telegramLinkLabel,
		telegramLinkVariant,
		type TelegramLinkStatus,
	} from '$lib/users';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import TokensPanel from '$components/tokens/TokensPanel.svelte';

	// A bare ?show=<id> (from the audit-log deep link, before /tokens redirected here) means the
	// caller wants a specific token, so open on the Tokens tab.
	const initialTab = page.url.searchParams.has('show') && !page.url.searchParams.has('tab')
		? 'tokens'
		: undefined;
	const tab = createUrlTab({ keys: ['users', 'tokens'], initial: initialTab });

	type User = RealmUser;

	let users = $state<User[]>([]);
	// Telegram link state per Keycloak sub. Absent from the roster means no subscriber row and no
	// identity, which reads the same as unlinked.
	let telegramStatus = $state(new Map<string, TelegramLinkStatus>());
	let loading = $state(true);
	let error = $state('');
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

	onMount(async () => {
		try {
			// The roster is supplementary: if it fails, the Telegram column degrades to "Not linked"
			// rather than taking the whole user list down with it.
			const [result, roster] = await Promise.all([
				api.users.list({ perPage: 500, sort: ['username', 'ASC'] }),
				getNotificationSubscribers().catch(() => []),
			]);
			users = result.data;
			telegramStatus = new Map(roster.map((s) => [s.keycloak_sub, s.telegram_status]));
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

	function levelKey(u: User): string {
		return highestAccessRole(u.roles) ?? '';
	}

	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return users.filter((u) => {
			if (roleFilter !== null && levelKey(u) !== roleFilter) return false;
			if (!q) return true;
			return (
				u.username?.toLowerCase().includes(q) ||
				u.email?.toLowerCase().includes(q) ||
				`${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(q)
			);
		});
	});

	function count(key: string | null): number {
		if (key === null) return users.length;
		return users.filter((u) => levelKey(u) === key).length;
	}
</script>

<svelte:head><title>Users & Tokens | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Users & Tokens</h2>
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
	{#if error}
		<ErrorNotice message="Failed to load users: {error}" />
	{/if}

	<div class="flex flex-wrap items-center gap-2">
		<input
			type="text"
			placeholder="Search…"
			bind:value={search}
			class="w-full max-w-xs px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<div class="flex flex-wrap gap-1.5">
			{#each FILTERS as f}
				<button
					type="button"
					onclick={() => (roleFilter = f.key)}
					class="px-2.5 py-1 text-xs font-medium rounded-full border transition-colors {roleFilter === f.key
						? 'bg-brand-primary text-white border-brand-primary'
						: 'bg-brand-surface text-brand-muted border-brand-divider hover:text-brand-text'}"
				>
					{f.label} ({count(f.key)})
				</button>
			{/each}
		</div>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Username</th>
					<th class="text-left px-4 py-2 font-semibold text-brand-muted">Email</th>
					<th class="text-left px-4 py-2 font-semibold">Name</th>
					<th class="text-left px-4 py-2 font-semibold">Role</th>
					<th class="text-left px-4 py-2 font-semibold">Telegram</th>
					<th class="text-left px-4 py-2 font-semibold">Enabled</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if filtered.length === 0}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No users found</td></tr>
				{:else}
					{#each filtered as u}
						<tr
							class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer"
							onclick={() => goto(`${base}/users/${u.id}`)}
						>
							<td class="px-4 py-2">
								<a
									href="{base}/users/{u.id}"
									onclick={(e) => e.stopPropagation()}
									class="text-brand-primary font-semibold no-underline hover:underline"
								>
									{u.username}
								</a>
							</td>
							<td class="px-4 py-2 text-brand-muted">{u.email || '-'}</td>
							<td class="px-4 py-2">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '-'}</td>
							<td class="px-4 py-2">
								<Badge variant={accessLevelVariant(u.roles)}>{accessLevelLabel(u.roles)}</Badge>
							</td>
							<td class="px-4 py-2">
								<Badge variant={telegramLinkVariant(telegramStatus.get(u.id))}>
									{telegramLinkLabel(telegramStatus.get(u.id))}
								</Badge>
							</td>
							<td class="px-4 py-2">{u.enabled ? '✓' : 'None'}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<p class="text-xs text-brand-muted">{filtered.length} of {users.length} users</p>
	{/if}
</div>
