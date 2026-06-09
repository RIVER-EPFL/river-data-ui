<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, type Project, type TokenPermissions } from '$api/crud';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import TokenAccessSummary from '$components/tokens/TokenAccessSummary.svelte';

	const isAdmin = $derived(auth.role === 'admin');
	const tokenId = page.params.id!;

	let name = $state('');
	let description = $state('');
	let projectScope = $state('');
	let projects = $state<Project[]>([]);
	let permissions = $state<TokenPermissions>({ read_metadata: true, read_data: true, write_metadata: false, write_data: false });
	let rateLimit = $state('');
	let expiryMode = $state<'never' | 'custom'>('never');
	let expiresAt = $state('');

	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);

	/** ISO string → value for <input type="datetime-local"> (local time, minute precision). */
	function toLocalInput(iso: string): string {
		const d = new Date(iso);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	const scopeName = $derived(projectScope ? (projects.find((p) => p.id === projectScope)?.name ?? null) : null);

	onMount(async () => {
		if (!isAdmin) {
			loading = false;
			return;
		}
		try {
			const [tok, projResult] = await Promise.all([
				api.apiTokens.get(tokenId),
				api.projects.list({ perPage: 100 }),
			]);
			projects = projResult.data;
			name = tok.name;
			description = tok.description ?? '';
			projectScope = tok.project_scope ?? '';
			permissions = { ...permissions, ...tok.permissions };
			rateLimit = tok.rate_limit_per_second ? String(tok.rate_limit_per_second) : '';
			if (tok.expires_at) {
				expiryMode = 'custom';
				expiresAt = toLocalInput(tok.expires_at);
			}
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load token';
		} finally {
			loading = false;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!name) return;
		saving = true;
		try {
			const payload: Record<string, unknown> = {
				name,
				permissions,
				description: description.trim() || null,
				project_scope: projectScope || null,
				rate_limit_per_second: rateLimit && Number(rateLimit) > 0 ? Number(rateLimit) : null,
				expires_at: expiryMode === 'custom' && expiresAt ? new Date(expiresAt).toISOString() : null,
			};
			await api.apiTokens.update(tokenId, payload);
			toastStore.success('Token updated — changes take effect immediately');
			goto(`${base}/tokens`);
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update token');
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Edit API Token | River Data</title></svelte:head>

<div class="space-y-4 max-w-2xl">
	<a href="{base}/tokens" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Back</a>
	<h2 class="text-xl font-semibold">Edit API Token</h2>

	{#if !isAdmin}
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			Administrator role required to manage API tokens.
		</div>
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else if error}
		<div class="p-3 bg-severity-alarm-soft border border-severity-alarm-border rounded-md text-sm text-severity-alarm">{error}</div>
	{:else}
		<div class="p-3 bg-brand-bg border border-brand-divider rounded-md text-xs text-brand-muted">
			Editing permissions, scope, expiry, or rate limit takes effect immediately. The secret is not
			editable — use <span class="font-medium">Rotate</span> on the list to issue a new secret.
		</div>

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="flex flex-col gap-1">
				<label for="name" class="text-sm font-medium">Name <span class="text-severity-alarm">*</span></label>
				<input id="name" type="text" bind:value={name} required class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
			</div>

			<div class="flex flex-col gap-1">
				<label for="description" class="text-sm font-medium">Description</label>
				<input id="description" type="text" bind:value={description} placeholder="e.g. NOMIS field logger, Martigny" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
			</div>

			<div class="flex flex-col gap-1">
				<label for="scope" class="text-sm font-medium">Project Scope</label>
				<select id="scope" bind:value={projectScope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
					<option value="">All projects</option>
					{#each projects as p}<option value={p.id}>{p.name}</option>{/each}
				</select>
				<span class="text-xs text-brand-muted">
					Security boundary — a scoped key can only read and write that project's data and inventory.
				</span>
			</div>

			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Permissions</legend>
				{#each Object.entries(permissions) as [key]}
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={permissions[key as keyof TokenPermissions]} class="w-4 h-4" />
						<span class="text-sm">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
					</label>
				{/each}
			</fieldset>

			<TokenAccessSummary {permissions} {projectScope} projectName={scopeName} />

			<div class="flex flex-col gap-1">
				<label for="rate" class="text-sm font-medium">Rate limit</label>
				<div class="flex items-center gap-2">
					<input id="rate" type="number" min="1" step="1" bind:value={rateLimit} placeholder="unlimited" class="w-32 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					<span class="text-xs text-brand-muted">requests / second (leave blank for unlimited)</span>
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<span class="text-sm font-medium">Expiry</span>
				<div class="flex gap-3">
					<label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" bind:group={expiryMode} value="never" /> <span class="text-sm">Never</span></label>
					<label class="flex items-center gap-1.5 cursor-pointer"><input type="radio" bind:group={expiryMode} value="custom" /> <span class="text-sm">Custom</span></label>
				</div>
				{#if expiryMode === 'custom'}
					<input type="datetime-local" bind:value={expiresAt} class="mt-1 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				{/if}
			</div>

			<div class="flex gap-2 pt-2">
				<button type="submit" disabled={saving} class="px-4 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none hover:bg-brand-primary-dark disabled:opacity-50">
					{saving ? 'Saving…' : 'Save Changes'}
				</button>
				<a href="{base}/tokens" class="px-4 py-1.5 border border-brand-divider rounded-md text-sm no-underline text-brand-text hover:bg-brand-bg">Cancel</a>
			</div>
		</form>
	{/if}
</div>
