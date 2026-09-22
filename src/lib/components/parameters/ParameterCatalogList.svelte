<script lang="ts">
	import { base } from '$app/paths';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { api, type AlarmThreshold, type Parameter } from '$api/crud';
	import ConfirmParameterButton from '$components/parameters/ConfirmParameterButton.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import { formatThresholdRange, globalThresholdsByParameter } from '$lib/alarms';
	import { toolboxHref } from '$lib/toolbox/route';

	type SiteRef = { id: string; name: string };

	// The host page passes the initial direct/derived filter (captured from the URL before its own
	// ?tab writeback runs). Standalone use falls back to reading the URL directly.
	let { initialType: initialTypeProp }: { initialType?: string } = $props();

	let parameters = $state<Parameter[]>([]);
	let searchQuery = $state('');

	// Category is a fixed DB enum (CHECK measurement|device_health); surface both as tickboxes even
	// when the data only contains one, so the available categories are discoverable.
	const KNOWN_CATEGORIES = ['measurement', 'device_health'];
	const initialType =
		untrack(() => initialTypeProp) ??
		page.url.searchParams.get('type') ??
		(page.url.searchParams.get('tab') === 'derived' ? 'derived' : '');
	// Exclusion sets - empty means "show everything"; a member is hidden. (Defaulting to nothing
	// excluded keeps any future category visible without extra wiring.)
	let excludedCats = $state<Set<string>>(new Set());
	let excludedTypes = $state<Set<string>>(
		new Set(initialType === 'derived' ? ['direct'] : initialType === 'direct' ? ['derived'] : []),
	);

	let sitesByParam = $state<Record<string, SiteRef[]>>({});
	let calculationByOutput = $state<Record<string, string>>({}); // output_parameter_id → calculation id
	let globalThresholds = $state<Record<string, AlarmThreshold>>({}); // a parameter's own bounds

	let sitesDialogOpen = $state(false);
	let sitesDialogParam = $state<Parameter | null>(null);

	// Show only mechanically-created entries awaiting a manager's confirmation.
	let reviewOnly = $state(false);
	// A row a calculation minted and gave up is still a parameter; hiding them is the way to read
	// the catalogue as what is being measured.
	let hideUnpublished = $state(false);

	let list = $state<ReturnType<typeof CrudList> | null>(null);

	const columns: Column[] = [
		{ key: 'name', label: 'Name' },
		{ key: 'code', label: 'Code', class: 'font-mono text-xs text-brand-muted' },
		{ key: 'default_units', label: 'Unit', class: 'text-brand-muted' },
		{ key: 'warning', label: 'Warning', sortable: false, class: 'text-xs text-severity-warning' },
		{ key: 'alarm', label: 'Alarm', sortable: false, class: 'text-xs text-severity-alarm' },
		{ key: 'category', label: 'Category' },
		{ key: 'sites', label: 'Sites', sortable: false, class: 'text-center' },
		{ key: 'created_at', label: 'Created', class: 'text-brand-muted text-xs' },
	];

	function sortKey(p: Parameter, field: string): string {
		switch (field) {
			case 'code': return p.code ?? '';
			case 'default_units': return p.default_units ?? '';
			case 'category': return p.category ?? '';
			case 'created_at': return p.created_at ?? '';
			default: return p.name ?? '';
		}
	}

	// The catalog is joined with its site parameters and derived definitions once, then the
	// tickboxes and the search narrow what is already loaded, which is what keeps the review count
	// honest while a filter is on.
	async function loadParameters({ page: p, perPage, sort }: PageRequest) {
		if (parameters.length === 0) {
			const [paramRes, spRes, siteRes, derivedRes, thresholds] = await Promise.all([
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 500 }),
				api.sites.list({ perPage: 200 }),
				api.derivedParameters.list({ perPage: 500 }),
				globalThresholdsByParameter(),
			]);
			parameters = paramRes.data;
			globalThresholds = thresholds;

			const siteNames = new Map(siteRes.data.map((s) => [s.id, s.name]));
			const byParam: Record<string, Map<string, string>> = {};
			for (const sp of spRes.data) {
				if (!sp.parameter_id) continue;
				(byParam[sp.parameter_id] ??= new Map()).set(sp.site_id, siteNames.get(sp.site_id) ?? sp.site_id);
			}
			const out: Record<string, SiteRef[]> = {};
			for (const [pid, m] of Object.entries(byParam)) {
				out[pid] = [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
			}
			sitesByParam = out;

			const defs: Record<string, string> = {};
			for (const d of derivedRes.data) {
				if (d.output_parameter_id && d.tool_script_id) defs[d.output_parameter_id] = d.tool_script_id;
			}
			calculationByOutput = defs;
		}

		const rows = [...matching].sort((a, b) => {
			const r = sortKey(a, sort[0]).localeCompare(sortKey(b, sort[0]));
			return sort[1] === 'ASC' ? r : -r;
		});
		return { data: rows.slice((p - 1) * perPage, p * perPage), total: rows.length };
	}

	const allCategories = $derived(
		[...new Set([...KNOWN_CATEGORIES, ...parameters.map((p) => p.category).filter(Boolean)])].sort(),
	);

	function isDerived(p: Parameter): boolean {
		return !!calculationByOutput[p.id];
	}
	function siteRefs(p: Parameter): SiteRef[] {
		return sitesByParam[p.id] ?? [];
	}

	const matching = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		return parameters.filter((p) => {
			if (excludedCats.has(p.category)) return false;
			if (excludedTypes.has(isDerived(p) ? 'derived' : 'direct')) return false;
			if (reviewOnly && !p.needs_review) return false;
			if (hideUnpublished && p.unpublished_by) return false;
			if (q) {
				const hay = `${p.name ?? ''} ${p.code ?? ''} ${p.description ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	const reviewCount = $derived(parameters.filter((p) => p.needs_review).length);
	const unpublishedCount = $derived(parameters.filter((p) => p.unpublished_by).length);

	// The confirmed row is replaced in place. With the filter on it drops out of the list, which is
	// how a run through the unreviewed entries advances.
	function applyConfirmed(updated: Parameter) {
		parameters = parameters.map((p) => (p.id === updated.id ? { ...p, ...updated } : p));
		list?.reload();
	}

	function openSites(p: Parameter) {
		sitesDialogParam = p;
		sitesDialogOpen = true;
	}
</script>

<CrudList
	bind:this={list}
	load={loadParameters}
	{columns}
	title="Parameters"
	showHeader={false}
	defaultSort={['name', 'ASC']}
	emptyText="No parameters found"
>
	{#snippet filterBar({ reload }: { reload: () => void })}
		<input
			type="text" placeholder="Search parameters…" bind:value={searchQuery}
			oninput={reload}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<div class="flex items-center gap-2 text-xs text-brand-muted">
			<span class="font-medium uppercase tracking-wide">Category</span>
			{#each allCategories as cat}
				<label class="flex items-center gap-1 cursor-pointer">
					<input
						type="checkbox"
						checked={!excludedCats.has(cat)}
						onchange={() => {
							const next = new Set(excludedCats);
							if (next.has(cat)) next.delete(cat); else next.add(cat);
							excludedCats = next;
							reload();
						}}
					/>
					{cat}
				</label>
			{/each}
		</div>
		<div class="flex items-center gap-2 text-xs text-brand-muted">
			<span class="font-medium uppercase tracking-wide">Type</span>
			{#each [['direct', 'Direct', 'Directly recorded parameters'], ['derived', 'Derived', 'Formula-derived parameters']] as [key, label, hint]}
				<label class="flex items-center gap-1 cursor-pointer" title={hint}>
					<input
						type="checkbox"
						checked={!excludedTypes.has(key)}
						onchange={() => {
							const next = new Set(excludedTypes);
							if (next.has(key)) next.delete(key); else next.add(key);
							excludedTypes = next;
							reload();
						}}
					/>
					{label}
				</label>
			{/each}
		</div>
		<label class="flex items-center gap-1 text-xs text-brand-muted cursor-pointer" title="Entries created mechanically (tool analyte seed) awaiting a manager's confirmation">
			<input type="checkbox" bind:checked={reviewOnly} onchange={reload} />
			Needs review only{#if reviewCount > 0}&nbsp;({reviewCount}){/if}
		</label>
		{#if unpublishedCount > 0}
			<label class="flex items-center gap-1 text-xs text-brand-muted cursor-pointer" title="Entries a calculation minted and no longer publishes: the formula that made them is now a step">
				<input type="checkbox" bind:checked={hideUnpublished} onchange={reload} />
				Hide no longer published&nbsp;({unpublishedCount})
			</label>
		{/if}
	{/snippet}

	{#snippet cell({ column, row, text }: { column: Column; row: Parameter; text: string })}
		{#if column.key === 'name'}
			{@const calcId = calculationByOutput[row.id]}
			<a href="{base}/parameters/{row.id}" class="text-brand-primary font-semibold no-underline hover:underline">{row.name}</a>
			{#if row.needs_review}
				<span class="ml-1.5 align-middle">
					<Badge
						variant="warning"
						title="Created by a sync or a tool save. Confirming asserts this is the analyte it names, and not a duplicate of one already in the catalog."
					>needs review</Badge>
				</span>
				<span class="ml-1.5 align-middle inline-block">
					<ConfirmParameterButton parameter={row} onconfirmed={applyConfirmed} />
				</span>
			{/if}
			{#if row.unpublished_by}
				<span class="ml-1.5 align-middle">
					<Badge
						variant="muted"
						title="Minted by {row.unpublished_by}, which no longer publishes it: its formula is a step of the calculation. Nothing computes this parameter."
					>no longer published</Badge>
				</span>
			{/if}
			{#if calcId}
				<a href={toolboxHref(base, calcId)} title="Formula-derived parameter - view the calculation that writes it" class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent-dark align-middle no-underline hover:underline">derived</a>
			{/if}
		{:else if column.key === 'warning' || column.key === 'alarm'}
			{@const t = globalThresholds[row.id]}
			{@const range = column.key === 'warning'
				? formatThresholdRange(t?.warning_min, t?.warning_max, row.default_units)
				: formatThresholdRange(t?.alarm_min, t?.alarm_max, row.default_units)}
			{#if range}{range}{:else}<span class="text-brand-muted">None</span>{/if}
		{:else if column.key === 'default_units'}
			{row.default_units || 'None'}
		{:else if column.key === 'category'}
			<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">{row.category}</span>
		{:else if column.key === 'sites'}
			{@const refs = siteRefs(row)}
			{#if refs.length > 0}
				<button onclick={() => openSites(row)} title="Show the sites using this parameter" class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok cursor-pointer border-none hover:underline">{refs.length}</button>
			{:else}
				<span class="text-xs text-brand-muted">0</span>
			{/if}
		{:else}
			{text}
		{/if}
	{/snippet}
</CrudList>

<Dialog bind:open={sitesDialogOpen} title={sitesDialogParam ? `Sites using ${sitesDialogParam.name}` : 'Sites'} maxWidth="sm">
	{#snippet children()}
		{@const refs = sitesDialogParam ? siteRefs(sitesDialogParam) : []}
		{#if refs.length === 0}
			<p class="text-sm text-brand-muted">No sites use this parameter.</p>
		{:else}
			<ul class="divide-y divide-brand-divider rounded-md border border-brand-divider overflow-hidden">
				{#each refs as s}
					<li><a href="{base}/sites/{s.id}" class="block px-3 py-2 text-sm text-brand-primary no-underline hover:bg-brand-bg">{s.name}</a></li>
				{/each}
			</ul>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (sitesDialogOpen = false)}>Close</Button>
	{/snippet}
</Dialog>
