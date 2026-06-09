<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { api, type ApiToken, type TokenPermissions } from '$api/crud';
	import { revokeToken, rotateToken } from '$api/service';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	const isAdmin = $derived(auth.role === 'admin');

	let tokens = $state<ApiToken[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state<string | null>(null);

	let rotatedSecret = $state('');
	let showSecret = $state(false);

	async function load() {
		loading = true;
		error = '';
		try {
			const result = await api.apiTokens.list({ perPage: 200 });
			tokens = result.data;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load tokens';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (isAdmin) load();
		else loading = false;
	});

	function formatPermissions(perms: TokenPermissions | string[] | undefined): string {
		if (!perms) return 'None';
		const keys = Array.isArray(perms)
			? perms
			: Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
		if (keys.length === 0) return 'none';
		return keys.map((p) => p.replace(/_/g, ' ')).join(', ');
	}

	function projectName(id: string | null | undefined): string {
		return id ? id.slice(0, 8) + '…' : 'All projects';
	}

	async function doRevoke(t: ApiToken) {
		if (!confirm(`Revoke token "${t.name}"? It will stop working immediately.`)) return;
		busy = t.id;
		try {
			await revokeToken(t.id);
			toastStore.success('Token revoked');
			await load();
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to revoke');
		} finally {
			busy = null;
		}
	}

	async function doRotate(t: ApiToken) {
		if (!confirm(`Rotate token "${t.name}"? The current secret stops working immediately.`)) return;
		busy = t.id;
		try {
			const updated = await rotateToken(t.id);
			rotatedSecret = updated.token ?? '';
			showSecret = true;
			await load();
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to rotate');
		} finally {
			busy = null;
		}
	}

	async function doDelete(t: ApiToken) {
		if (!confirm(`Permanently delete token "${t.name}"? This removes its audit history.`)) return;
		busy = t.id;
		try {
			await api.apiTokens.remove(t.id);
			toastStore.success('Token deleted');
			await load();
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to delete');
		} finally {
			busy = null;
		}
	}

	function copySecret() {
		navigator.clipboard.writeText(rotatedSecret);
		toastStore.success('Token copied to clipboard');
	}
</script>

<svelte:head><title>API Tokens | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">API Tokens</h2>
		{#if isAdmin}
			<a href="{base}/tokens/new" class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold no-underline hover:bg-brand-primary-dark">New Token</a>
		{/if}
	</div>

	{#if !isAdmin}
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			Administrator role required to manage API tokens.
		</div>
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else if error}
		<div class="p-3 bg-severity-alarm-soft border border-severity-alarm-border rounded-md text-sm text-severity-alarm">{error}</div>
	{:else if tokens.length === 0}
		<p class="text-sm text-brand-muted">No tokens yet. Create one to let an external client or logger push data via the API.</p>
	{:else}
		<div class="overflow-x-auto border border-brand-divider rounded-md">
			<table class="w-full text-sm">
				<thead class="bg-brand-bg text-left text-xs uppercase tracking-wide text-brand-muted">
					<tr>
						<th class="px-3 py-2">Name</th>
						<th class="px-3 py-2">Description</th>
						<th class="px-3 py-2">Permissions</th>
						<th class="px-3 py-2">Scope</th>
						<th class="px-3 py-2">Rate</th>
						<th class="px-3 py-2">Last used</th>
						<th class="px-3 py-2">Status</th>
						<th class="px-3 py-2">Expires</th>
						<th class="px-3 py-2 text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each tokens as t (t.id)}
						<tr class="border-t border-brand-divider {t.is_active === false ? 'opacity-60' : ''}">
							<td class="px-3 py-2 font-medium">
								{t.name}
								{#if t.token_prefix}<span class="block text-xs text-brand-muted font-mono">rvd_{t.token_prefix}…</span>{/if}
							</td>
							<td class="px-3 py-2 text-brand-muted">{t.description ?? 'None'}</td>
							<td class="px-3 py-2">{formatPermissions(t.permissions)}</td>
							<td class="px-3 py-2">{projectName(t.project_scope)}</td>
							<td class="px-3 py-2">{t.rate_limit_per_second ? `${t.rate_limit_per_second}/s` : '∞'}</td>
							<td class="px-3 py-2 text-brand-muted">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}</td>
							<td class="px-3 py-2">
								{#if t.is_active === false}
									<span class="text-severity-alarm">Revoked</span>
								{:else}
									<span class="text-severity-ok">Active</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-brand-muted">{t.expires_at ? new Date(t.expires_at).toLocaleDateString() : 'Never'}</td>
							<td class="px-3 py-2">
								<div class="flex gap-2 justify-end">
									{#if t.is_active !== false}
										<button onclick={() => doRevoke(t)} disabled={busy === t.id} class="text-xs px-2 py-1 border border-severity-warning-border text-severity-warning rounded hover:bg-severity-warning-soft disabled:opacity-50">Revoke</button>
									{/if}
									<button onclick={() => doRotate(t)} disabled={busy === t.id} class="text-xs px-2 py-1 border border-brand-divider rounded hover:bg-brand-bg disabled:opacity-50">Rotate</button>
									<button onclick={() => doDelete(t)} disabled={busy === t.id} class="text-xs px-2 py-1 border border-severity-alarm-border text-severity-alarm rounded hover:bg-severity-alarm-soft disabled:opacity-50">Delete</button>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<Dialog bind:open={showSecret} title="New Token Secret" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
				The old secret has stopped working. Copy the new one now - it will not be shown again.
			</div>
			<div class="p-3 bg-brand-bg rounded-md font-mono text-xs break-all select-all">{rotatedSecret}</div>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={copySecret} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none">Copy</button>
		<button onclick={() => (showSecret = false)} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface hover:bg-brand-bg">Done</button>
	{/snippet}
</Dialog>
