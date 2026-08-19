<script lang="ts">
	import { api, type Parameter } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import type { ParameterResolution } from './manifest';
	import { markClass, type Severity } from '$lib/tools/validation';

	// The catalog parameter one tool output saves to. The link has two halves: `parameterId` is
	// authoritative, `code` is what survives being loaded into another database. Both are written
	// together so the server never sees an id and a code naming different parameters.
	let {
		parameterId = $bindable(null),
		code = $bindable(null),
		catalog = [],
		resolution,
		mark = undefined,
		declaredUnits = null,
		wantedCode = '',
		wantedLabel = '',
		disabled = false,
		ariaLabel = 'Catalog parameter',
		onSelect = null,
		onCreated = null,
	}: {
		parameterId: string | null;
		code: string | null;
		catalog?: Parameter[];
		/** What this output's declaration resolves to, resolved once by the host. */
		resolution: ParameterResolution;
		/** The severity the page's validation model attaches to this link, when the field is marked. */
		mark?: Severity | undefined;
		/** Only to prefill a new catalog entry; the units mismatch is shown by the units field. */
		declaredUnits?: string | null;
		/** What to prefill a new catalog entry with. */
		wantedCode?: string;
		wantedLabel?: string;
		disabled?: boolean;
		ariaLabel?: string;
		/** Fired on every link change, so the host can follow it (the units a row inherits). */
		onSelect?: ((parameter: Parameter | null) => void) | null;
		/** Fired after a catalog entry is created here, so the host can refresh its list. */
		onCreated?: ((parameter: Parameter) => void | Promise<void>) | null;
	} = $props();

	const field = 'w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs';

	let search = $state('');
	let open = $state(false);
	let showCreate = $state(false);
	let newCode = $state('');
	let newName = $state('');
	let newUnits = $state('');
	let creating = $state(false);

	const canCreate = $derived(me.can('admin'));

	const resolved = $derived(resolution.parameter);
	const resolvedBy = $derived(resolution.by);
	const dangling = $derived(resolution.dangling);

	const norm = (s: string) => s.trim().toLowerCase();

	const matches = $derived.by((): Parameter[] => {
		const q = norm(search);
		const pool = q
			? catalog.filter((p) => norm(p.code).includes(q) || norm(p.name).includes(q))
			: catalog;
		// Reviewed entries first: the flagged ones are there to be recognised, not preferred.
		return [...pool]
			.sort(
				(a, b) =>
					Number(a.needs_review) - Number(b.needs_review) || a.code.localeCompare(b.code),
			)
			.slice(0, 40);
	});

	function select(p: Parameter) {
		parameterId = p.id;
		code = p.code;
		open = false;
		search = '';
		onSelect?.(p);
	}

	function clear() {
		parameterId = null;
		code = null;
		open = false;
		search = '';
		onSelect?.(null);
	}

	/** Point the authoritative half at the row the code already resolves to. */
	function repair() {
		if (resolved) select(resolved);
	}

	function openCreate() {
		newCode = code ?? wantedCode;
		newName = wantedLabel || wantedCode || newCode;
		newUnits = declaredUnits ?? '';
		showCreate = true;
	}

	async function create() {
		const c = newCode.trim();
		if (!c) return;
		creating = true;
		try {
			const created = await api.parameters.create({
				code: c,
				name: newName.trim() || c,
				default_units: newUnits.trim(),
				category: 'measurement',
				aliases: [],
			});
			select(created);
			showCreate = false;
			await onCreated?.(created);
			toastStore.success(`${created.name} added to the catalog`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to create the catalog parameter');
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex flex-col gap-1">
	{#if resolved && !open}
		<div class="flex items-start gap-1">
			<div class="min-w-0">
				<div class="font-mono truncate">{resolved.code}</div>
				<div class="text-brand-muted truncate">
					{resolved.name}{resolved.default_units ? ` (${resolved.default_units})` : ''}
				</div>
			</div>
			<span class="grow"></span>
			{#if !disabled}
				<Button size="sm" variant="ghost" onclick={() => (open = true)}>Change</Button>
			{/if}
		</div>
		{#if resolved.needs_review}
			<Badge variant="muted">from the previous portal</Badge>
		{/if}
		{#if dangling}
			<Button
				size="sm"
				variant="ghost"
				title="The stored id is not in this catalog; the code resolves instead"
				onclick={repair}>Point at {resolved.code}</Button
			>
		{:else if resolvedBy === 'code'}
			<span class="text-brand-muted" title="Linked by code, not by id">by code</span>
		{/if}
	{:else}
		<input
			type="text"
			aria-label={ariaLabel}
			placeholder={code ? code : 'Search code or name…'}
			bind:value={search}
			{disabled}
			onfocus={() => (open = true)}
			class="{field} {markClass(mark)}"
		/>
		{#if open}
			<div class="max-h-48 overflow-y-auto rounded-md border border-brand-divider bg-brand-bg">
				{#each matches as p, i (p.id)}
					{#if p.needs_review && !matches[i - 1]?.needs_review}
						<!-- The seeded portal analytes and anything a sync discovered. Grouped so an
						     existing analyte is picked instead of a near-duplicate being minted. -->
						<p class="px-2 pt-1.5 pb-0.5 text-brand-muted font-medium border-t border-brand-divider">
							From the previous portal
						</p>
					{/if}
					<button
						type="button"
						class="w-full text-left px-2 py-1 hover:bg-brand-surface"
						onclick={() => select(p)}
					>
						<span class="font-mono">{p.code}</span>
						<span class="text-brand-muted"
							>{p.name}{p.default_units ? ` (${p.default_units})` : ''}</span
						>
					</button>
				{:else}
					<p class="px-2 py-1 text-brand-muted">No parameter matches.</p>
				{/each}
			</div>
			<div class="flex items-center gap-1">
				<Button size="sm" variant="ghost" onclick={() => ((open = false), (search = ''))}>
					Close
				</Button>
				{#if code || parameterId}
					<Button size="sm" variant="ghost" onclick={clear}>Clear link</Button>
				{/if}
				{#if canCreate && !showCreate}
					<Button size="sm" variant="ghost" onclick={openCreate}>New parameter…</Button>
				{/if}
			</div>
		{/if}
	{/if}

	{#if showCreate}
		<div class="rounded-md border border-brand-divider bg-brand-bg p-2 space-y-1.5">
			<div class="flex flex-wrap items-center gap-1.5">
				<input
					bind:value={newCode}
					aria-label="New parameter code"
					placeholder="Code"
					class="w-24 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs font-mono"
				/>
				<input
					bind:value={newName}
					aria-label="New parameter name"
					placeholder="Name"
					class="flex-1 min-w-28 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
				/>
				<input
					bind:value={newUnits}
					aria-label="New parameter units"
					placeholder="Units"
					class="w-20 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
				/>
			</div>
			<div class="flex items-center gap-1.5">
				<Button size="sm" variant="primary" onclick={create} disabled={!newCode.trim() || creating}>
					{creating ? 'Creating…' : 'Create and link'}
				</Button>
				<Button size="sm" onclick={() => (showCreate = false)}>Cancel</Button>
			</div>
		</div>
	{:else if !resolved && !open && canCreate && !disabled}
		<Button size="sm" variant="ghost" onclick={openCreate}>New parameter…</Button>
	{/if}
</div>
