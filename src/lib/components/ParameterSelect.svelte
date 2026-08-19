<script lang="ts">
	import { base } from '$app/paths';
	import { api, type Parameter, type SiteParameter } from '$api/crud';
	import { listAll } from '$api/paged';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';

	// Select-only parameter picker: the parameters configured at a site (siteId), or the global
	// catalog (global). Hosts that already hold the lists pass them to skip the fetch. Flagged
	// (needs_review) parameters are marked in the list and badged when selected.
	//
	// With `allowAdd`, an unmapped picker also offers the way out of the dead end: the wanted
	// parameter can be added to the site here (manager level), or created in the catalog first
	// (administrator) when nothing in the catalog matches. Everyone else is told which of those two
	// is missing, since the person to ask differs.
	let {
		value = $bindable(''),
		siteId = null,
		global = false,
		parameters = null,
		siteParams = null,
		disabled = false,
		placeholder = ' - Select a parameter - ',
		ariaLabel = 'Parameter',
		id,
		allowAdd = false,
		siteName = null,
		wantedCode = null,
		wantedLabel = null,
		wantedUnits = null,
		onCreated = null,
	}: {
		value: string;
		siteId?: string | null;
		global?: boolean;
		parameters?: Parameter[] | null;
		siteParams?: SiteParameter[] | null;
		disabled?: boolean;
		placeholder?: string;
		ariaLabel?: string;
		id?: string;
		/** Offer the add-to-site affordance when nothing at the site matches. */
		allowAdd?: boolean;
		siteName?: string | null;
		/** What the host is looking for: catalog code, human label and units, all best-effort. */
		wantedCode?: string | null;
		wantedLabel?: string | null;
		wantedUnits?: string | null;
		/** Fired after a site_parameters row is created here, so the host can refresh its lists. */
		onCreated?: ((parameterId: string) => void | Promise<void>) | null;
	} = $props();

	let fetchedParams = $state<Parameter[]>([]);
	let fetchedSiteParams = $state<SiteParameter[]>([]);
	let loading = $state(false);

	const catalog = $derived(parameters ?? fetchedParams);
	const siteRows = $derived(siteParams ?? fetchedSiteParams);

	$effect(() => {
		const needCatalog = !parameters;
		const needSite = !global && !!siteId && !siteParams;
		if (!needCatalog && !needSite) return;
		loading = true;
		const wantedSite = siteId;
		Promise.all([
			needCatalog
				? listAll(api.parameters, { perPage: 500, sort: ['name', 'ASC'] })
				: Promise.resolve(null),
			needSite && wantedSite
				? listAll(api.siteParameters, { perPage: 500, filter: { site_id: wantedSite } })
				: Promise.resolve(null),
		])
			.then(([p, sp]) => {
				if (p) fetchedParams = p;
				if (sp && wantedSite === siteId) fetchedSiteParams = sp;
			})
			.catch((e) =>
				toastStore.error(e instanceof Error ? e.message : 'Failed to load parameters'),
			)
			.finally(() => (loading = false));
	});

	interface Option {
		parameterId: string;
		label: string;
		needsReview: boolean;
	}

	function catalogParam(parameterId: string): Parameter | undefined {
		return catalog.find((p) => p.id === parameterId);
	}

	const options = $derived.by((): Option[] => {
		if (global) {
			return catalog.map((p) => ({
				parameterId: p.id,
				label: p.default_units ? `${p.name} (${p.default_units})` : p.name,
				needsReview: p.needs_review,
			}));
		}
		return siteRows.map((sp) => {
			const p = catalogParam(sp.parameter_id);
			const name = p?.name ?? sp.name ?? sp.parameter_id;
			const units = sp.display_units ?? p?.default_units ?? '';
			return {
				parameterId: sp.parameter_id,
				label: units ? `${name} (${units})` : name,
				needsReview: p?.needs_review ?? false,
			};
		});
	});

	const selectedNeedsReview = $derived(
		!!value && (options.find((o) => o.parameterId === value)?.needsReview ?? false),
	);

	// Matching ignores case, spaces, underscores and hyphens, so a result key (`DOC_mg_L`) still
	// finds the catalog entry an operator would recognise as the same analyte.
	const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');

	const wantedName = $derived(wantedCode ?? wantedLabel ?? '');
	const wantedKeys = $derived([wantedCode, wantedLabel].map(norm).filter((s) => s.length > 0));

	const catalogMatch = $derived.by((): Parameter | null => {
		if (wantedKeys.length === 0) return null;
		return (
			catalog.find(
				(p) =>
					wantedKeys.includes(norm(p.code)) ||
					wantedKeys.includes(norm(p.name)) ||
					(p.aliases ?? []).some((a) => wantedKeys.includes(norm(a))),
			) ?? null
		);
	});

	const atSite = $derived(new Set(siteRows.map((sp) => sp.parameter_id)));
	const matchAtSite = $derived(!!catalogMatch && atSite.has(catalogMatch.id));
	const unassigned = $derived(
		catalog
			.filter((p) => !atSite.has(p.id) && p.category === 'measurement')
			.sort((a, b) => a.name.localeCompare(b.name)),
	);

	const siteLabel = $derived(siteName ?? 'this site');
	const canAssign = $derived(me.can('writeCatalog'));
	const canCreateCatalog = $derived(me.can('admin'));

	// The dead end only needs answering while the row has no parameter and the host asked for it.
	// A wanted parameter that is already at the site is not a dead end: it is in the select.
	const showAdd = $derived(
		!global && !!siteId && allowAdd && !disabled && !loading && !value && !matchAtSite,
	);

	let addParamId = $state('');
	let adding = $state(false);
	let showCatalogForm = $state(false);
	let newCode = $state('');
	let newName = $state('');
	let newUnits = $state('');
	let creating = $state(false);

	// Default the picker to the catalog entry that matches what the host is after, so the common
	// case is one click.
	$effect(() => {
		const suggested = catalogMatch && !atSite.has(catalogMatch.id) ? catalogMatch.id : '';
		if (suggested && !addParamId) addParamId = suggested;
	});

	function openCatalogForm() {
		newCode = wantedCode ?? wantedLabel ?? '';
		newName = wantedLabel ?? wantedCode ?? '';
		newUnits = wantedUnits ?? '';
		showCatalogForm = true;
	}

	async function assign(parameterId: string) {
		if (!siteId || !parameterId) return;
		const created = await api.siteParameters.create({ site_id: siteId, parameter_id: parameterId });
		// Keep the locally fetched list usable; a host that owns the list refreshes via onCreated.
		fetchedSiteParams = [...fetchedSiteParams, created];
		value = parameterId;
		await onCreated?.(parameterId);
	}

	async function addToSite() {
		if (!addParamId) return;
		adding = true;
		try {
			await assign(addParamId);
			addParamId = '';
			toastStore.success(`Added to ${siteLabel}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to add the parameter to the site');
		} finally {
			adding = false;
		}
	}

	async function createAndAdd() {
		const code = newCode.trim();
		const name = newName.trim() || code;
		if (!code) return;
		creating = true;
		try {
			const param = await api.parameters.create({
				code,
				name,
				default_units: newUnits.trim(),
				category: 'measurement',
				aliases: [],
			});
			fetchedParams = [...fetchedParams, param];
			await assign(param.id);
			showCatalogForm = false;
			toastStore.success(`${name} created and added to ${siteLabel}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to create the catalog parameter');
		} finally {
			creating = false;
		}
	}
</script>

<div class="flex flex-col gap-0.5">
	<select
		{id}
		bind:value
		disabled={disabled || loading}
		aria-label={ariaLabel}
		class="w-full px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50"
	>
		<option value="">{loading ? 'Loading…' : placeholder}</option>
		{#each options as o (o.parameterId)}
			<option value={o.parameterId}>{o.label}{o.needsReview ? ' · needs review' : ''}</option>
		{/each}
	</select>
	{#if selectedNeedsReview}
		<Badge variant="warning">needs review</Badge>
	{/if}

	{#if showAdd}
		<div class="rounded-md border border-brand-divider bg-brand-bg p-2 mt-1 space-y-1.5">
			{#if catalogMatch}
				<p class="text-xs">
					<span class="font-medium">{catalogMatch.name}</span> is in the parameter catalog but is
					not configured at {siteLabel}.
				</p>
			{:else if wantedName}
				<p class="text-xs">
					No catalog parameter matches <span class="font-mono">{wantedName}</span>. The catalog
					entry has to exist before any site can record it.
				</p>
			{:else}
				<p class="text-xs">Nothing at {siteLabel} matches this output yet.</p>
			{/if}

			{#if canAssign && unassigned.length > 0}
				<div class="flex items-center gap-1.5 flex-wrap">
					<select
						bind:value={addParamId}
						aria-label="Parameter to add to the site"
						class="flex-1 min-w-40 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						<option value=""> - Select a catalog parameter - </option>
						{#each unassigned as p (p.id)}
							<option value={p.id}>
								{p.default_units ? `${p.name} (${p.default_units})` : p.name}
							</option>
						{/each}
					</select>
					<Button
						size="sm"
						variant="primary"
						onclick={addToSite}
						disabled={!addParamId || adding}
					>
						{adding ? 'Adding…' : 'Add to site'}
					</Button>
				</div>
			{/if}

			{#if !catalogMatch && canCreateCatalog}
				{#if showCatalogForm}
					<div class="space-y-1.5">
						<div class="flex items-center gap-1.5 flex-wrap">
							<input
								bind:value={newCode}
								aria-label="Parameter code"
								placeholder="Code"
								class="w-28 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
							/>
							<input
								bind:value={newName}
								aria-label="Parameter name"
								placeholder="Name"
								class="flex-1 min-w-32 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
							/>
							<input
								bind:value={newUnits}
								aria-label="Parameter units"
								placeholder="Units"
								class="w-24 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
							/>
						</div>
						<div class="flex items-center gap-1.5">
							<Button
								size="sm"
								variant="primary"
								onclick={createAndAdd}
								disabled={!newCode.trim() || creating}
							>
								{creating ? 'Creating…' : 'Create and add to site'}
							</Button>
							<Button size="sm" onclick={() => (showCatalogForm = false)}>Cancel</Button>
						</div>
					</div>
				{:else}
					<Button size="sm" onclick={openCatalogForm}>Create catalog entry…</Button>
				{/if}
			{/if}

			{#if !canAssign}
				<p class="text-xs text-brand-muted">
					{#if catalogMatch}
						A manager or administrator adds a catalog parameter to a site. Ask for
						<span class="font-medium">{catalogMatch.name}</span>
						at {siteLabel}.
					{:else}
						An administrator creates the catalog entry, then a manager adds it to {siteLabel}. Ask
						for a parameter named
						<span class="font-mono">{wantedName || 'this output'}</span>{wantedUnits
							? ` in ${wantedUnits}`
							: ''}.
					{/if}
					{#if siteId}
						<a href="{base}/sites/{siteId}?tab=parameters" class="text-brand-primary hover:underline"
							>Site parameters</a
						>
					{/if}
				</p>
			{:else if !catalogMatch && !canCreateCatalog}
				<p class="text-xs text-brand-muted">
					An administrator creates a new catalog entry; you can add any existing one above.
				</p>
			{/if}
		</div>
	{:else if !global && !loading && !disabled && options.length === 0 && !siteId}
		<p class="text-xs text-brand-muted">Select a site first</p>
	{:else if !global && !loading && !disabled && options.length === 0 && siteId && !allowAdd}
		<p class="text-xs text-brand-muted">
			No parameters configured at {siteLabel}; a manager can add one.
		</p>
	{/if}
</div>
