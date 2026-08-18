<script lang="ts">
	import { api, type Parameter, type SiteParameter } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';

	// Select-only parameter picker: the parameters configured at a site (siteId), or the global
	// catalog (global). Hosts that already hold the lists pass them to skip the fetch. Flagged
	// (needs_review) parameters are marked in the list and badged when selected.
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
				? api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }).then((r) => r.data)
				: Promise.resolve(null),
			needSite && wantedSite
				? api.siteParameters
						.list({ perPage: 500, filter: { site_id: wantedSite } })
						.then((r) => r.data)
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
	{#if !global && !loading && !disabled && options.length === 0 && (siteId || siteRows.length === 0)}
		<p class="text-xs text-brand-muted">
			{siteId
				? 'No parameters configured at this site; ask a manager to add this parameter to the site.'
				: 'Select a site first'}
		</p>
	{/if}
</div>
