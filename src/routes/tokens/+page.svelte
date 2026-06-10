<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, type ApiToken, type Project } from '$api/crud';
	import { revokeToken, rotateToken } from '$api/service';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import TokenDetailDialog from '$components/tokens/TokenDetailDialog.svelte';
	import PermissionChips from '$components/tokens/PermissionChips.svelte';

	const isAdmin = $derived(auth.role === 'admin');

	let tokens = $state<ApiToken[]>([]);
	let projects = $state<Project[]>([]);
	let loading = $state(true);
	let error = $state('');
	let busy = $state<string | null>(null);

	let rotatedSecret = $state('');
	let showSecret = $state(false);

	let detailToken = $state<ApiToken | null>(null);
	let showDetail = $state(false);

	let hideExpired = $state(false);

	// Deep link from the audit log: /tokens?show=<id> opens that token's detail dialog. Captured
	// synchronously so the cleanup effect below can't race it away before onMount reads it.
	const initialShow = page.url.searchParams.get('show');
	let deepLinkHandled = false;

	function tokenRank(t: ApiToken): number {
		if (t.is_active === false) return 2;
		if (isExpired(t)) return 1;
		return 0;
	}
	const hasExpired = $derived(tokens.some((t) => isExpired(t)));
	const mainTokens = $derived(
		[...tokens].filter((t) => !isExpired(t)).sort((a, b) => tokenRank(a) - tokenRank(b)),
	);
	const expiredTokens = $derived(tokens.filter((t) => isExpired(t)));

	async function load() {
		loading = true;
		error = '';
		try {
			const [tokenResult, projectResult] = await Promise.all([
				api.apiTokens.list({ perPage: 200 }),
				api.projects.list({ perPage: 100 }),
			]);
			tokens = tokenResult.data;
			projects = projectResult.data;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load tokens';
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		if (!isAdmin) {
			loading = false;
			return;
		}
		await load();
		if (initialShow) {
			let t = tokens.find((x) => x.id === initialShow);
			if (!t) {
				try {
					t = await api.apiTokens.get(initialShow);
				} catch {
					t = undefined;
				}
			}
			if (t) openDetail(t);
			deepLinkHandled = true;
		}
	});

	// Once a deep-linked dialog is closed, drop ?show so a refresh doesn't reopen it.
	$effect(() => {
		if (deepLinkHandled && !showDetail && page.url.searchParams.has('show')) {
			const url = new URL(page.url);
			url.searchParams.delete('show');
			goto(url, { replaceState: true, noScroll: true, keepFocus: true });
			deepLinkHandled = false;
		}
	});

	function openDetail(t: ApiToken) {
		detailToken = t;
		showDetail = true;
	}

	function projectName(id: string | null | undefined): string {
		if (!id) return 'All projects';
		return projects.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';
	}

	function isExpired(t: ApiToken): boolean {
		return !!t.expires_at && new Date(t.expires_at).getTime() <= Date.now();
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

	async function reEnable(t: ApiToken) {
		busy = t.id;
		try {
			const expires_at = new Date(Date.now() + 90 * 864e5).toISOString();
			await api.apiTokens.update(t.id, { expires_at });
			toastStore.success('Enabled for 90 days - edit to alter expiry if necessary');
			await load();
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to re-enable');
		} finally {
			busy = null;
		}
	}

	async function doRotate(t: ApiToken) {
		const warning = isExpired(t)
			? ` Note: rotating will NOT extend the expiry - the new secret stays expired until you change the expiry (use Re-enable or Edit).`
			: '';
		if (!confirm(`Rotate token "${t.name}"? The current secret stops working immediately.${warning}`)) return;
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

	const actionBtn =
		'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
	const neutralBtn = `${actionBtn} border-brand-divider text-brand-muted hover:bg-brand-bg hover:text-brand-text`;
	const warnBtn = `${actionBtn} border-severity-warning-border text-severity-warning hover:bg-severity-warning-soft`;
	const dangerBtn = `${actionBtn} border-severity-alarm-border text-severity-alarm hover:bg-severity-alarm-soft`;
	const successBtn = `${actionBtn} border-severity-ok-border text-severity-ok hover:bg-severity-ok-soft`;
</script>

{#snippet iconEdit()}<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>{/snippet}
{#snippet iconClock()}<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>{/snippet}
{#snippet iconRevoke()}<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>{/snippet}
{#snippet iconRotate()}<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>{/snippet}
{#snippet iconTrash()}<svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>{/snippet}

{#snippet tokenTable(rows: ApiToken[])}
	<div class="overflow-x-auto rounded-md border border-brand-divider">
		<table class="w-full table-fixed text-sm">
			<colgroup>
				<col style="width: 22%" />
				<col style="width: 26%" />
				<col style="width: 16%" />
				<col style="width: 10%" />
				<col style="width: 12%" />
				<col style="width: 14%" />
			</colgroup>
			<thead class="bg-brand-bg text-left text-xs uppercase tracking-wide text-brand-muted">
				<tr>
					<th class="px-3 py-2">Name</th>
					<th class="px-3 py-2">Permissions</th>
					<th class="px-3 py-2">Scope</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2">Expires</th>
					<th class="px-3 py-2 text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as t (t.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
					<tr
						onclick={() => openDetail(t)}
						class="cursor-pointer border-t border-brand-divider hover:bg-brand-bg {t.is_active === false ? 'opacity-60' : ''}"
					>
						<td class="px-3 py-2 font-medium">
							<button onclick={(e) => { e.stopPropagation(); openDetail(t); }} class="cursor-pointer text-left hover:underline">
								{t.name}
								{#if t.token_prefix}<span class="block truncate font-mono text-xs font-normal text-brand-muted">rvd_{t.token_prefix}…</span>{/if}
							</button>
						</td>
						<td class="px-3 py-2"><PermissionChips permissions={t.permissions} /></td>
						<td class="truncate px-3 py-2">{projectName(t.project_scope)}</td>
						<td class="px-3 py-2">
							{#if t.is_active === false}
								<Badge variant="alarm">Revoked</Badge>
							{:else if isExpired(t)}
								<Badge variant="accent">Expired</Badge>
							{:else}
								<Badge variant="ok">Active</Badge>
							{/if}
						</td>
						<td class="px-3 py-2">
							{#if t.expires_at}
								<div class={isExpired(t) ? 'text-brand-accent-dark' : ''}>{formatDateTime(t.expires_at)}</div>
							{:else}
								<span class="text-brand-muted">Never</span>
							{/if}
						</td>
						<td class="px-3 py-2">
							<div class="flex justify-end gap-1">
								<a href="{base}/tokens/{t.id}/edit" onclick={(e) => e.stopPropagation()} title="Edit" aria-label="Edit" class="{neutralBtn} no-underline">{@render iconEdit()}</a>
								{#if t.is_active !== false}
									{#if isExpired(t)}
										<button onclick={(e) => { e.stopPropagation(); reEnable(t); }} disabled={busy === t.id} title="Re-enable for 90 days" aria-label="Re-enable for 90 days" class={successBtn}>{@render iconClock()}</button>
									{:else}
										<button onclick={(e) => { e.stopPropagation(); doRevoke(t); }} disabled={busy === t.id} title="Revoke (disable, keep record)" aria-label="Revoke" class={warnBtn}>{@render iconRevoke()}</button>
									{/if}
								{/if}
								<button onclick={(e) => { e.stopPropagation(); doRotate(t); }} disabled={busy === t.id} title="Rotate secret" aria-label="Rotate secret" class={neutralBtn}>{@render iconRotate()}</button>
								<button onclick={(e) => { e.stopPropagation(); doDelete(t); }} disabled={busy === t.id} title="Delete permanently" aria-label="Delete permanently" class={dangerBtn}>{@render iconTrash()}</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<svelte:head><title>API Tokens | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">API Tokens</h2>
		<div class="flex items-center gap-3">
			{#if isAdmin && hasExpired}
				<label class="flex cursor-pointer items-center gap-1.5 text-xs text-brand-muted">
					<input type="checkbox" bind:checked={hideExpired} class="h-3.5 w-3.5 cursor-pointer" />
					Hide expired
				</label>
			{/if}
			{#if isAdmin}
				<a href="{base}/tokens/new" class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold no-underline hover:bg-brand-primary-dark">New Token</a>
			{/if}
		</div>
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
		{#if mainTokens.length > 0}
			{@render tokenTable(mainTokens)}
		{/if}
		{#if !hideExpired && expiredTokens.length > 0}
			<div class="space-y-2">
				<h3 class="text-sm font-semibold uppercase tracking-wide text-brand-accent-dark">
					Expired ({expiredTokens.length})
				</h3>
				{@render tokenTable(expiredTokens)}
			</div>
		{/if}
		{#if mainTokens.length === 0 && (hideExpired || expiredTokens.length === 0)}
			<p class="text-sm text-brand-muted">No active tokens.</p>
		{/if}
	{/if}
</div>

<TokenDetailDialog bind:open={showDetail} token={detailToken} {projectName} />

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
		<Button variant="primary" onclick={copySecret}>Copy</Button>
		<Button onclick={() => (showSecret = false)}>Done</Button>
	{/snippet}
</Dialog>
