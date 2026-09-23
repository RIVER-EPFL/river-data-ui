<script lang="ts">
	import { onMount } from 'svelte';
	import { listAll } from '$api/paged';
	import { listReplicateAudits, type ReplicateAuditHold, type HoldKind } from '$api/service';
	import { api, type Parameter, type Site } from '$api/crud';
	import { dayBounds, dayOf, formatDateTime } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import { KIND_LABEL, KIND_STYLE, KIND_TIP, TAG_KINDS } from '$lib/holds';
	import {
		oursText,
		sourceText,
		tagPointHref,
		tagQuery,
		type TagFilter,
	} from '$lib/discrepancies';
	import Button from '$components/ui/Button.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	const PER_PAGE = 100;

	let {
		initial = {},
	}: {
		initial?: TagFilter;
	} = $props();

	// Deliberate initial-value capture: the filters are the operator's once the browse is open.
	// svelte-ignore state_referenced_locally
	let kind = $state<HoldKind | ''>(initial.kind ?? '');
	// svelte-ignore state_referenced_locally
	let siteId = $state(initial.siteId ?? '');
	// svelte-ignore state_referenced_locally
	let parameterId = $state(initial.parameterId ?? '');
	// svelte-ignore state_referenced_locally
	let fromDay = $state(dayOf(initial.from, timezoneStore.zone));
	// svelte-ignore state_referenced_locally
	let toDay = $state(dayOf(initial.to, timezoneStore.zone, true));
	// An arrival narrowed below a day (one reading's instant) keeps its exact bounds until the
	// operator changes the period.
	// svelte-ignore state_referenced_locally
	let exact = $state<{ from?: string; to?: string } | null>(
		initial.from &&
		initial.to &&
		dayBounds(dayOf(initial.from, timezoneStore.zone), timezoneStore.zone)?.start !== initial.from
			? { from: initial.from, to: initial.to }
			: null,
	);
	// svelte-ignore state_referenced_locally
	const streamIds = initial.streamIds;
	// svelte-ignore state_referenced_locally
	const classification = initial.classification;

	let sites = $state<Site[]>([]);
	let parameters = $state<Parameter[]>([]);

	onMount(async () => {
		try {
			const [s, p] = await Promise.all([
				listAll(api.sites, { sort: ['name', 'ASC'] }),
				listAll(api.parameters, { sort: ['name', 'ASC'] }),
			]);
			sites = s;
			parameters = p;
		} catch {
			// The lists only feed the dropdowns; the browse still reads without them.
		}
	});

	function filter(): TagFilter {
		return {
			kind: kind || undefined,
			siteId: siteId || undefined,
			parameterId: parameterId || undefined,
			from: exact ? exact.from : dayBounds(fromDay, timezoneStore.zone)?.start,
			to: exact ? exact.to : dayBounds(toDay, timezoneStore.zone)?.end,
			streamIds,
			classification,
		};
	}

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const result = await listReplicateAudits(tagQuery(filter(), page, perPage));
		return { data: result.holds, total: result.total };
	}

	function slotLabel(hold: ReplicateAuditHold): string {
		if (hold.site_name && hold.parameter_name) return `${hold.site_name} · ${hold.parameter_name}`;
		return hold.source_name ?? hold.source_key ?? 'Unpaired stream';
	}
</script>

<EventPanel load={loadPage} perPage={PER_PAGE} colCount={6} emptyText="No discrepancies recorded under these filters">
	{#snippet filterBar({ reload })}
		<div class="flex flex-wrap items-center gap-2">
			<select
				bind:value={kind}
				onchange={() => reload()}
				aria-label="Kind"
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
			>
				<option value="">Every kind</option>
				{#each TAG_KINDS as k}
					<option value={k}>{KIND_LABEL[k]}</option>
				{/each}
			</select>
			<select
				bind:value={siteId}
				onchange={() => reload()}
				aria-label="Site"
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
			>
				<option value="">Every site</option>
				{#each sites as s (s.id)}
					<option value={s.id}>{s.name}</option>
				{/each}
			</select>
			<select
				bind:value={parameterId}
				onchange={() => reload()}
				aria-label="Parameter"
				class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
			>
				<option value="">Every parameter</option>
				{#each parameters as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
			<label class="flex items-center gap-1 text-xs text-brand-muted">
				From
				<input
					type="date"
					bind:value={fromDay}
					onchange={() => { exact = null; reload(); }}
					class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
				/>
			</label>
			<label class="flex items-center gap-1 text-xs text-brand-muted">
				To
				<input
					type="date"
					bind:value={toDay}
					onchange={() => { exact = null; reload(); }}
					class="px-2 py-1 text-xs rounded-md border border-brand-divider bg-brand-surface"
				/>
			</label>
			{#if exact}
				<span class="px-2 py-0.5 rounded-full bg-brand-bg text-xs text-brand-text">One reading's instant</span>
				<button
					onclick={() => { exact = null; reload(); }}
					class="bg-transparent border-none p-0 cursor-pointer text-xs text-brand-primary underline-offset-2 hover:underline"
				>Any time</button>
			{/if}
		</div>
		<Button onclick={reload}>Refresh</Button>
	{/snippet}

	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Instant</th>
		<th class="text-left px-3 py-2 font-semibold">Kind</th>
		<th class="text-left px-3 py-2 font-semibold">Site · parameter</th>
		<th class="text-left px-3 py-2 font-semibold">Source</th>
		<th class="text-left px-3 py-2 font-semibold">River-data</th>
		<th class="text-left px-3 py-2 font-semibold"></th>
	{/snippet}

	{#snippet row(hold)}
		{@const href = tagPointHref(hold)}
		<td class="px-4 py-2 text-xs whitespace-nowrap">{formatDateTime(hold.group_time)}</td>
		<td class="px-3 py-2">
			<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {KIND_STYLE[hold.kind]}" title={KIND_TIP[hold.kind]}>
				{KIND_LABEL[hold.kind]}
			</span>
		</td>
		<td class="px-3 py-2 text-xs" title={hold.source_key ?? undefined}>{slotLabel(hold)}</td>
		<td class="px-3 py-2 font-mono text-xs">{sourceText(hold)}</td>
		<td class="px-3 py-2 font-mono text-xs">{oursText(hold)}</td>
		<td class="px-3 py-2 text-xs">
			{#if href}
				<a {href} class="text-brand-primary no-underline hover:underline">Point record</a>
			{/if}
		</td>
	{/snippet}
</EventPanel>
