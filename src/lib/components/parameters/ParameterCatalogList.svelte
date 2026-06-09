<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, type Parameter } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';
	import Dialog from '$components/ui/Dialog.svelte';

	type SiteRef = { id: string; name: string };

	let parameters = $state<Parameter[]>([]);
	let loading = $state(true);

	let sortField = $state('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchQuery = $state('');

	// Category is a fixed DB enum (CHECK measurement|device_health); surface both as tickboxes even
	// when the data only contains one, so the available categories are discoverable.
	const KNOWN_CATEGORIES = ['measurement', 'device_health'];
	const initialType =
		page.url.searchParams.get('type') ??
		(page.url.searchParams.get('tab') === 'derived' ? 'derived' : '');
	// Exclusion sets - empty means "show everything"; a member is hidden. (Defaulting to nothing
	// excluded keeps any future category visible without extra wiring.)
	let excludedCats = $state<Set<string>>(new Set());
	let excludedTypes = $state<Set<string>>(
		new Set(initialType === 'derived' ? ['direct'] : initialType === 'direct' ? ['derived'] : []),
	);

	let sitesByParam = $state<Record<string, SiteRef[]>>({});
	let derivedDefByOutput = $state<Record<string, string>>({}); // output_parameter_id → definition id

	let sitesDialogOpen = $state(false);
	let sitesDialogParam = $state<Parameter | null>(null);

	const PER_PAGE = 25;
	let currentPage = $state(1);

	onMount(async () => {
		try {
			const [paramRes, spRes, siteRes, derivedRes] = await Promise.all([
				api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
				api.siteParameters.list({ perPage: 500 }),
				api.sites.list({ perPage: 200 }),
				api.derivedParameters.list({ perPage: 500 }),
			]);
			parameters = paramRes.data;

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
				if (d.output_parameter_id) defs[d.output_parameter_id] = d.id;
			}
			derivedDefByOutput = defs;
		} finally {
			loading = false;
		}
	});

	const allCategories = $derived(
		[...new Set([...KNOWN_CATEGORIES, ...parameters.map((p) => p.category).filter(Boolean)])].sort(),
	);

	function toggleCat(cat: string) {
		const next = new Set(excludedCats);
		if (next.has(cat)) next.delete(cat); else next.add(cat);
		excludedCats = next;
		currentPage = 1;
	}
	function toggleType(t: string) {
		const next = new Set(excludedTypes);
		if (next.has(t)) next.delete(t); else next.add(t);
		excludedTypes = next;
		currentPage = 1;
	}

	function isDerived(p: Parameter): boolean {
		return !!derivedDefByOutput[p.id];
	}
	function siteRefs(p: Parameter): SiteRef[] {
		return sitesByParam[p.id] ?? [];
	}

	function fmtRange(min: number | null, max: number | null): string {
		if (min == null && max == null) return 'None';
		const lo = min != null ? String(min) : '';
		const hi = max != null ? String(max) : '';
		return `${lo} – ${hi}`;
	}

	const filtered = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		const rows = parameters.filter((p) => {
			if (excludedCats.has(p.category)) return false;
			if (excludedTypes.has(isDerived(p) ? 'derived' : 'direct')) return false;
			if (q) {
				const hay = `${p.name ?? ''} ${p.code ?? ''} ${p.description ?? ''}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
		const key = (p: Parameter): string => {
			switch (sortField) {
				case 'code': return p.code ?? '';
				case 'default_units': return p.default_units ?? '';
				case 'category': return p.category ?? '';
				case 'created_at': return p.created_at ?? '';
				default: return p.name ?? '';
			}
		};
		rows.sort((a, b) => {
			const r = String(key(a)).localeCompare(String(key(b)));
			return sortOrder === 'ASC' ? r : -r;
		});
		return rows;
	});

	const total = $derived(filtered.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)));
	const pageRows = $derived(filtered.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE));

	function toggleSort(field: string) {
		if (sortField === field) sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		else { sortField = field; sortOrder = 'ASC'; }
		currentPage = 1;
	}

	function resetPage() { currentPage = 1; }

	function openSites(p: Parameter) {
		sitesDialogParam = p;
		sitesDialogOpen = true;
	}
</script>

<div class="space-y-4">
	<div class="flex gap-3 items-center flex-wrap">
		<input
			type="text" placeholder="Search parameters..." bind:value={searchQuery}
			oninput={resetPage}
			class="w-64 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<div class="flex items-center gap-2 text-xs text-brand-muted">
			<span class="font-medium uppercase tracking-wide">Category</span>
			{#each allCategories as cat}
				<label class="flex items-center gap-1 cursor-pointer">
					<input type="checkbox" checked={!excludedCats.has(cat)} onchange={() => toggleCat(cat)} />
					{cat}
				</label>
			{/each}
		</div>
		<div class="flex items-center gap-2 text-xs text-brand-muted">
			<span class="font-medium uppercase tracking-wide">Type</span>
			<label class="flex items-center gap-1 cursor-pointer" title="Directly recorded parameters">
				<input type="checkbox" checked={!excludedTypes.has('direct')} onchange={() => toggleType('direct')} />
				Direct
			</label>
			<label class="flex items-center gap-1 cursor-pointer" title="Formula-derived parameters">
				<input type="checkbox" checked={!excludedTypes.has('derived')} onchange={() => toggleType('derived')} />
				Derived
			</label>
		</div>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					{#each [['name', 'Name'], ['code', 'Code'], ['default_units', 'Unit'], ['warning', 'Warning'], ['alarm', 'Alarm'], ['category', 'Category'], ['sites', 'Sites'], ['created_at', 'Created']] as [key, label]}
						{@const sortable = key !== 'warning' && key !== 'alarm' && key !== 'sites'}
						<th class="px-4 py-2 font-semibold {key === 'sites' ? 'text-center' : 'text-left'} {sortable ? 'cursor-pointer select-none hover:text-brand-primary' : ''}" onclick={() => { if (sortable) toggleSort(key); }}>
							{label} {sortField === key ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="8" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
				{:else if pageRows.length === 0}
					<tr><td colspan="8" class="px-4 py-8 text-center text-brand-muted">No parameters found</td></tr>
				{:else}
					{#each pageRows as param}
						{@const refs = siteRefs(param)}
						{@const defId = derivedDefByOutput[param.id]}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/parameters/{param.id}" class="text-brand-primary font-semibold no-underline hover:underline">{param.name}</a>
								{#if defId}
									<a href="{base}/derived/{defId}" title="Formula-derived parameter - view its definition" class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent align-middle no-underline hover:underline">derived</a>
								{/if}
							</td>
							<td class="px-4 py-2 font-mono text-xs text-brand-muted">{param.code}</td>
							<td class="px-4 py-2 text-brand-muted">{param.default_units || 'None'}</td>
							<td class="px-4 py-2 text-xs text-severity-warning-main">{fmtRange(param.default_warning_min, param.default_warning_max)}</td>
							<td class="px-4 py-2 text-xs text-severity-alarm-main">{fmtRange(param.default_alarm_min, param.default_alarm_max)}</td>
							<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">{param.category}</span></td>
							<td class="px-4 py-2 text-center">
								{#if refs.length > 0}
									<button onclick={() => openSites(param)} title="Show the sites using this parameter" class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok cursor-pointer border-none hover:underline">{refs.length}</button>
								{:else}
									<span class="text-xs text-brand-muted">0</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(param.created_at)}</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	{#if totalPages > 1}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<button onclick={() => { currentPage = Math.max(1, currentPage - 1); }} disabled={currentPage <= 1} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Prev</button>
				<span>{currentPage} / {totalPages}</span>
				<button onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); }} disabled={currentPage >= totalPages} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface disabled:opacity-40 cursor-pointer disabled:cursor-default">Next</button>
			</div>
		</div>
	{/if}
</div>

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
		<button onclick={() => (sitesDialogOpen = false)} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Close</button>
	{/snippet}
</Dialog>
