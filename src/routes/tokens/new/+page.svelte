<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, type Project } from '$api/crud';
	import { POST } from '$api/client';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import TokenAccessSummary from '$components/tokens/TokenAccessSummary.svelte';
	import TokenUsagePanel from '$components/tokens/TokenUsagePanel.svelte';

	const isAdmin = $derived(auth.role === 'admin');

	let name = $state('');
	let description = $state('');
	let projectScope = $state('');
	let projects = $state<Project[]>([]);
	let permissions = $state({ read_metadata: true, read_data: true, write_metadata: false, write_data: false });
	let rateLimit = $state('');
	let expiryMode = $state<'never' | 'custom'>('never');
	let expiresAt = $state('');
	let saving = $state(false);

	let showTokenDialog = $state(false);
	let createdToken = $state('');
	let showUsage = $state(false);

	const scopeName = $derived(
		projectScope ? (projects.find((p) => p.id === projectScope)?.name ?? null) : null
	);

	onMount(async () => {
		const result = await api.projects.list({ perPage: 100 });
		projects = result.data;
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!name) return;
		saving = true;
		try {
			const payload: Record<string, unknown> = {
				name,
				// The API stores a permissions OBJECT and parses it as TokenPermissions; an array
				// would silently fall back to defaults.
				permissions,
				created_by: auth.identity?.fullName ?? '',
			};
			if (description.trim()) payload.description = description.trim();
			if (projectScope) payload.project_scope = projectScope;
			if (rateLimit && Number(rateLimit) > 0) payload.rate_limit_per_second = Number(rateLimit);
			if (expiryMode === 'custom' && expiresAt) payload.expires_at = new Date(expiresAt).toISOString();

			const result = await POST<{ id: string; token?: string }>('/api/tokens', payload);
			createdToken = result.token ?? '';
			showTokenDialog = true;
		} catch (e: unknown) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to create token');
		} finally {
			saving = false;
		}
	}

	function copyToken() {
		navigator.clipboard.writeText(createdToken);
		toastStore.success('Token copied to clipboard');
	}
</script>

<svelte:head><title>New API Token | River Data</title></svelte:head>

<div class="space-y-4 max-w-2xl">
	<a href="{base}/tokens" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Back</a>
	<h2 class="text-xl font-semibold">New API Token</h2>

	{#if !isAdmin}
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			Administrator role required to create API tokens.
		</div>
	{:else}
	<form onsubmit={handleSubmit} class="space-y-4">
		<div class="flex flex-col gap-1">
			<label for="name" class="text-sm font-medium">Name <span class="text-severity-alarm">*</span></label>
			<input id="name" type="text" bind:value={name} required class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
		</div>

		<div class="flex flex-col gap-1">
			<label for="description" class="text-sm font-medium">Description</label>
			<input id="description" type="text" bind:value={description} placeholder="e.g. NOMIS field logger, Martigny" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
			<span class="text-xs text-brand-muted">Which external client or logger this key is for</span>
		</div>

		<div class="flex flex-col gap-1">
			<label for="scope" class="text-sm font-medium">Project Scope</label>
			<select id="scope" bind:value={projectScope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
				<option value="">All projects</option>
				{#each projects as p}<option value={p.id}>{p.name}</option>{/each}
			</select>
			<span class="text-xs text-brand-muted">
				Security boundary - a scoped key can only read and write that project's data and inventory,
				and cannot see other projects. Leave as "All projects" for an unscoped key.
			</span>
		</div>

		<fieldset class="space-y-2">
			<legend class="text-sm font-medium">Permissions</legend>
			{#each Object.entries(permissions) as [key, val]}
				<label class="flex items-center gap-2 cursor-pointer">
					<input type="checkbox" bind:checked={permissions[key as keyof typeof permissions]} class="w-4 h-4" />
					<span class="text-sm">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
				</label>
			{/each}
			<p class="text-xs text-brand-muted">
				read metadata = list/view entities · read data = download readings · write metadata =
				create/edit entities · write data = push readings
			</p>
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
				{saving ? 'Creating...' : 'Create Token'}
			</button>
			<a href="{base}/tokens" class="px-4 py-1.5 border border-brand-divider rounded-md text-sm no-underline text-brand-text hover:bg-brand-bg">Cancel</a>
		</div>
	</form>
	{/if}
</div>

<Dialog bind:open={showTokenDialog} title="Token Created" maxWidth="lg">
	{#snippet children()}
		<div class="space-y-3">
			<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
				Copy this token now. It will not be shown again.
			</div>
			<div class="p-3 bg-brand-bg rounded-md font-mono text-xs break-all select-all">{createdToken}</div>

			<TokenAccessSummary {permissions} {projectScope} projectName={scopeName} />

			<button
				type="button"
				onclick={() => (showUsage = !showUsage)}
				class="text-sm text-brand-primary hover:underline cursor-pointer bg-transparent border-none px-0"
			>
				{showUsage ? 'Hide usage examples' : 'Show usage examples (curl / Python / R) with this key ↓'}
			</button>
			{#if showUsage}
				<TokenUsagePanel token={createdToken} {permissions} />
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={copyToken} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none">Copy token</button>
		<button onclick={() => { showTokenDialog = false; showUsage = false; goto(`${base}/tokens`); }} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface hover:bg-brand-bg">Done</button>
	{/snippet}
</Dialog>
