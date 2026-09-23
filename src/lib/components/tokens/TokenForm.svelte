<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { listAll } from '$api/paged';
	import { api, type Project, type TokenPermissions } from '$api/crud';
	import { POST } from '$api/client';
	import { auth } from '$auth/keycloak.svelte';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { emptyTokenForm, tokenFormOf, tokenPayload } from '$lib/tokens';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import TokenAccessSummary from '$components/tokens/TokenAccessSummary.svelte';
	import TokenUsagePanel from '$components/tokens/TokenUsagePanel.svelte';
	import PresetChips from '$components/tokens/PresetChips.svelte';

	// The token form in both modes. A create POSTs and hands back the one-time secret; an edit loads
	// the stored token first and PATCHes. What each mode sends is `tokenPayload`.
	let { mode, tokenId = null }: { mode: 'create' | 'edit'; tokenId?: string | null } = $props();

	const isAdmin = $derived(me.can('admin'));

	let form = $state(emptyTokenForm());
	let projects = $state<Project[]>([]);
	// Create renders at once; edit has nothing to show until the stored token is read back.
	let loading = $state(untrack(() => mode === 'edit'));
	let error = $state('');
	let saving = $state(false);

	let showTokenDialog = $state(false);
	let createdToken = $state('');
	let showUsage = $state(false);

	const scopeName = $derived(
		form.projectScope ? (projects.find((p) => p.id === form.projectScope)?.name ?? null) : null
	);

	function presetExpiry(days: number) {
		if (days === 0) {
			form.expiryMode = 'never';
			form.expiresAt = '';
			return;
		}
		if (days < 0) {
			// "Custom date…" - reveal the manual picker without changing the value.
			form.expiryMode = 'custom';
			return;
		}
		const d = new Date();
		d.setDate(d.getDate() + days);
		form.expiresAt = d.toISOString();
		form.expiryMode = 'custom';
	}

	const EXPIRY_PRESETS = [
		{ label: '90 days', value: 90 },
		{ label: '180 days', value: 180 },
		{ label: '1 year', value: 365 },
		{ label: 'Custom date…', value: -1 },
		{ label: 'No expiry', value: 0 },
	];
	const expiryActive = (v: number) =>
		v === 0 ? form.expiryMode === 'never' : v === -1 ? form.expiryMode === 'custom' : false;
	const RATE_PRESETS = [
		{ label: '1/s', value: 1 },
		{ label: '10/s', value: 10 },
		{ label: '50/s', value: 50 },
		{ label: '100/s', value: 100 },
		{ label: 'Unlimited', value: 0 },
	];
	const rateActive = (v: number) => (v === 0 ? !form.rateLimit : Number(form.rateLimit) === v);

	onMount(async () => {
		if (!isAdmin) {
			loading = false;
			return;
		}
		try {
			const [token, projResult] = await Promise.all([
				mode === 'edit' && tokenId ? api.apiTokens.get(tokenId) : Promise.resolve(null),
				listAll(api.projects),
			]);
			projects = projResult;
			if (token) form = tokenFormOf(token);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load token';
		} finally {
			loading = false;
		}
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!form.name) return;
		saving = true;
		try {
			const payload = tokenPayload(mode, form, auth.identity?.fullName ?? '');
			if (mode === 'edit' && tokenId) {
				await api.apiTokens.update(tokenId, payload);
				toastStore.success('Token updated - changes take effect immediately');
				goto(`${base}/tokens`);
			} else {
				const result = await POST<{ id: string; token?: string }>('/api/tokens', payload);
				createdToken = result.token ?? '';
				showTokenDialog = true;
			}
		} catch (e: unknown) {
			toastStore.error(
				e instanceof Error ? e.message : `Failed to ${mode === 'edit' ? 'update' : 'create'} token`
			);
		} finally {
			saving = false;
		}
	}

	function copyToken() {
		navigator.clipboard.writeText(createdToken);
		toastStore.success('Token copied to clipboard');
	}
</script>

<svelte:head><title>{mode === 'edit' ? 'Edit' : 'New'} API Token | RIVER Data</title></svelte:head>

<div class="space-y-4 max-w-2xl">
	<a href="{base}/tokens" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Back</a>
	<h2 class="text-xl font-semibold">{mode === 'edit' ? 'Edit' : 'New'} API Token</h2>

	{#if !isAdmin}
		<div class="p-4 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			Administrator role required to {mode === 'edit' ? 'manage' : 'create'} API tokens.
		</div>
	{:else if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else}
		{#if mode === 'edit'}
			<div class="p-3 bg-brand-bg border border-brand-divider rounded-md text-xs text-brand-muted">
				Editing permissions, scope, expiry, or rate limit takes effect immediately. The secret is not
				editable - use <span class="font-medium">Rotate</span> on the list to issue a new secret.
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="flex flex-col gap-1">
				<label for="name" class="text-sm font-medium">Name <span class="text-severity-alarm">*</span></label>
				<input id="name" type="text" bind:value={form.name} required class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
			</div>

			<div class="flex flex-col gap-1">
				<label for="description" class="text-sm font-medium">Description</label>
				<input id="description" type="text" bind:value={form.description} placeholder="e.g. NOMIS field logger, Martigny" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
				<span class="text-xs text-brand-muted">Which external client or logger this key is for</span>
			</div>

			<div class="flex flex-col gap-1">
				<label for="scope" class="text-sm font-medium">Project Scope</label>
				<select id="scope" bind:value={form.projectScope} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
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
				{#each Object.keys(form.permissions) as key}
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={form.permissions[key as keyof TokenPermissions]} class="w-4 h-4" />
						<span class="text-sm">{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
					</label>
				{/each}
				<p class="text-xs text-brand-muted">
					read metadata = list/view entities · read data = download readings · write metadata =
					create/edit entities · write data = push readings
				</p>
			</fieldset>

			<TokenAccessSummary permissions={form.permissions} projectScope={form.projectScope} projectName={scopeName} />

			<div class="flex flex-col gap-1">
				<label for="rate" class="text-sm font-medium">Rate limit</label>
				<div class="flex items-center gap-2">
					<input id="rate" type="number" min="1" step="1" bind:value={form.rateLimit} placeholder="unlimited" class="w-32 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					<span class="text-xs text-brand-muted">requests / second (leave blank for unlimited)</span>
				</div>
				<PresetChips options={RATE_PRESETS} onpick={(v) => (form.rateLimit = v > 0 ? String(v) : '')} active={rateActive} />
			</div>

			<div class="flex flex-col gap-1">
				<span class="text-sm font-medium">Expiry</span>
				<PresetChips options={EXPIRY_PRESETS} onpick={presetExpiry} active={expiryActive} />
				{#if form.expiryMode === 'custom'}
					<TimestampInput bind:value={form.expiresAt} ariaLabel="Expires at" class="mt-1" />
				{:else}
					<span class="text-xs text-brand-muted">This key never expires.</span>
				{/if}
			</div>

			<div class="flex gap-2 pt-2">
				<Button variant="primary" type="submit" disabled={saving}>
					{saving ? (mode === 'edit' ? 'Saving…' : 'Creating…') : mode === 'edit' ? 'Save Changes' : 'Create Token'}
				</Button>
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

			<TokenAccessSummary permissions={form.permissions} projectScope={form.projectScope} projectName={scopeName} />

			<Button
				variant="ghost"
				size="sm"
				onclick={() => (showUsage = !showUsage)}
				class="text-brand-primary px-0"
			>
				{showUsage ? 'Hide usage examples' : 'Show usage examples (curl / Python / R) with this key ↓'}
			</Button>
			{#if showUsage}
				<TokenUsagePanel token={createdToken} permissions={form.permissions} projectScope={form.projectScope} />
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="primary" onclick={copyToken}>Copy token</Button>
		<Button onclick={() => { showTokenDialog = false; showUsage = false; goto(`${base}/tokens`); }}>Done</Button>
	{/snippet}
</Dialog>
