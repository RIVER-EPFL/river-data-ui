<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listAll } from '$api/paged';
	import { api, type Site, type Project, type Subproject } from '$api/crud';
	import { formatRelativeTime } from '$lib/utils';
	import {
		getBackfillCandidates,
		backfillAttribution,
		reprocessAll,
		reconcileAlarms,
		type BackfillSiteSummary,
	} from '$api/service';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import OriginBadge from '$components/crud/OriginBadge.svelte';
	import OriginFilter from '$components/crud/OriginFilter.svelte';
	import { originFilter, type Origin } from '$lib/origin';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import { formatCount } from '$lib/format';

	let sites = $state<Site[]>([]);
	let projects = $state<Project[]>([]);
	let subprojects = $state<Subproject[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let currentPage = $state(1);
	let sortField = $state<string>('name');
	let sortOrder = $state<'ASC' | 'DESC'>('ASC');
	let searchFilter = $state('');
	let origin = $state<Origin>('any');

	// Historical-attribution backfill candidates, indexed by site.
	let backfillBySite = $state<Map<string, BackfillSiteSummary>>(new Map());
	let totalClaimable = $state(0);
	let backfilling = $state<string | null>(null); // site_id or 'all' while in flight
	// Count of currently-deployed sensors per site (for the Attribution column when nothing to backfill).
	let sensorCountBySite = $state<Map<string, number>>(new Map());

	const perPage = 25;

	async function loadSensorCounts() {
		try {
			const deps = await api.sensorDeployments.list({ perPage: 500, filter: { deployed_until: null } });
			const bySite = new Map<string, Set<string>>();
			for (const d of deps.data) {
				if (!bySite.has(d.site_id)) bySite.set(d.site_id, new Set());
				bySite.get(d.site_id)!.add(d.sensor_id);
			}
			sensorCountBySite = new Map([...bySite].map(([s, set]) => [s, set.size]));
		} catch {
			sensorCountBySite = new Map();
		}
	}

	async function loadBackfill() {
		try {
			const res = await getBackfillCandidates();
			backfillBySite = new Map(res.by_site.map((s) => [s.site_id, s]));
			totalClaimable = res.total_claimable;
		} catch {
			backfillBySite = new Map();
			totalClaimable = 0;
		}
	}

	async function runBackfill(body: { all?: boolean; site_id?: string }, key: string) {
		backfilling = key;
		try {
			const res = await backfillAttribution(body);
			toastStore.success(
				`Backfilling ${res.deployments_updated} deployment(s) - ~${res.estimated_readings} readings attributed in the background`,
			);
			await loadBackfill();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Backfill failed');
		} finally {
			backfilling = null;
		}
	}

	let operating = $state<string | null>(null);

	// The two installation-wide operations: re-derive every slot from the deployment and
	// calibration timelines, which runs as a tracked job, and reconcile the persisted alarm events
	// against what the readings now imply, which runs here and answers with what it changed.
	async function runOperation(key: 'backdate' | 'alarms') {
		operating = key;
		try {
			if (key === 'backdate') {
				const res = await reprocessAll();
				toastStore.success(`Backdating ${formatCount(res.slots)} slot(s), job ${res.job_id.slice(0, 8)}`);
			} else {
				const res = await reconcileAlarms();
				toastStore.success(
					`Alarm events reconciled: ${formatCount(res.opened)} opened, ${formatCount(res.updated)} updated, ${formatCount(res.resolved)} resolved`,
				);
			}
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'The operation was refused');
		} finally {
			operating = null;
		}
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const filter: Record<string, unknown> = { ...originFilter(origin, 'discovered_at') };
			if (searchFilter) filter.q = searchFilter;

			const [result, projectResult, subprojectResult] = await Promise.all([
				api.sites.list({
					page: currentPage,
					perPage,
					sort: [sortField, sortOrder],
					filter,
				}),
				projects.length === 0 ? listAll(api.projects) : Promise.resolve(null),
				subprojects.length === 0
					? listAll(api.subprojects)
					: Promise.resolve(null),
			]);
			sites = result.data;
			total = result.total;
			if (projectResult) projects = projectResult;
			if (subprojectResult) subprojects = subprojectResult;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load sites';
		} finally {
			loading = false;
		}
	}

	function projectName(id: string): string {
		return projects.find((p) => p.id === id)?.name ?? 'None';
	}

	function subprojectName(id: string | null): string {
		if (!id) return '-';
		return subprojects.find((s) => s.id === id)?.name ?? '-';
	}

	function toggleSort(field: string) {
		if (sortField === field) {
			sortOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
		} else {
			sortField = field;
			sortOrder = 'ASC';
		}
		currentPage = 1;
		load();
	}

	const totalPages = $derived(Math.ceil(total / perPage));

	onMount(() => { load(); loadBackfill(); loadSensorCounts(); });
</script>

<svelte:head>
	<title>Sites | RIVER Data</title>
</svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Sites</h2>
		<div class="flex items-center gap-2">
			{#if totalClaimable > 0}
				<ConfirmPopover
					message="Backfill {formatCount(totalClaimable)} readings across all sites?"
					confirmLabel="Backfill all"
					confirmVariant="primary"
					onconfirm={() => runBackfill({ all: true }, 'all')}
				>
					<Button
						disabled={backfilling !== null}
					>{backfilling === 'all' ? 'Backfilling…' : `Backfill all (${formatCount(totalClaimable)})`}</Button>
				</ConfirmPopover>
			{/if}
			{#if me.can('writeData')}
				<ConfirmPopover
					message="Re-derive instrument, deployment and calibration attribution for every (site, parameter) slot? One backdate runs at a time; a second request joins the one already queued."
					confirmLabel="Backdate"
					confirmVariant="primary"
					onconfirm={() => runOperation('backdate')}
				>
					<Button disabled={operating !== null}>{operating === 'backdate' ? 'Backdating…' : 'Backdate attribution'}</Button>
				</ConfirmPopover>
				<ConfirmPopover
					message="Reconcile the persisted alarm events against the breaches the readings currently imply? Events that no longer breach are resolved and new ones opened."
					confirmLabel="Reconcile"
					confirmVariant="primary"
					onconfirm={() => runOperation('alarms')}
				>
					<Button disabled={operating !== null}>{operating === 'alarms' ? 'Reconciling…' : 'Reconcile alarms'}</Button>
				</ConfirmPopover>
			{/if}
			<a
				href="{base}/sites/new"
				class="px-3 py-1.5 bg-brand-primary text-white rounded-md no-underline text-sm font-semibold hover:bg-brand-primary-dark"
			>
				Create
			</a>
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<input
			type="text"
			placeholder="Search sites…"
			bind:value={searchFilter}
			oninput={() => { currentPage = 1; load(); }}
			class="w-full max-w-sm px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
		<OriginFilter bind:value={origin} onchange={() => { currentPage = 1; load(); }} />
	</div>

	<!-- Table -->
	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th
						class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary"
						onclick={() => toggleSort('name')}
					>
						Name {sortField === 'name' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
					</th>
					<th class="text-left px-4 py-2 font-semibold">Project</th>
					<th class="text-left px-4 py-2 font-semibold">Subproject</th>
					<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
					<th
						class="text-left px-4 py-2 font-semibold cursor-pointer select-none hover:text-brand-primary"
						onclick={() => toggleSort('created_at')}
					>
						Created {sortField === 'created_at' ? (sortOrder === 'ASC' ? '↑' : '↓') : ''}
					</th>
					<th class="text-left px-4 py-2 font-semibold">Attribution</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if error}
					<tr><td colspan="6" class="px-4 py-8 text-center text-severity-alarm">{error}</td></tr>
				{:else if sites.length === 0}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No sites found</td></tr>
				{:else}
					{#each sites as site}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
							<td class="px-4 py-2">
								<a href="{base}/sites/{site.id}" class="text-brand-primary font-semibold no-underline hover:underline">
									{site.name}
								</a>
								<span class="ml-1.5 align-middle inline-block"><OriginBadge discoveredAt={site.discovered_at} /></span>
							</td>
							<td class="px-4 py-2 text-brand-muted">{projectName(site.project_id)}</td>
							<td class="px-4 py-2 text-brand-muted">{subprojectName(site.subproject_id)}</td>
							<td class="px-4 py-2 text-brand-muted font-mono text-xs">
								{#if site.latitude && site.longitude}
									{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
								{:else} - {/if}
							</td>
							<td class="px-4 py-2 text-brand-muted text-xs">{formatRelativeTime(site.created_at)}</td>
							<td class="px-4 py-2">
								{#if backfillBySite.get(site.id) || sensorCountBySite.get(site.id)}
									<div class="flex flex-col gap-0.5">
										{#if backfillBySite.get(site.id)}
											{@const bf = backfillBySite.get(site.id)!}
											<button
												onclick={() => runBackfill({ site_id: site.id }, site.id)}
												disabled={backfilling !== null}
												title="Attribute {formatCount(bf.claimable_count)} unattributed readings across {bf.deployments} deployment(s)"
												class="px-2 py-0.5 text-xs rounded bg-severity-warning-soft text-severity-warning cursor-pointer border-none hover:opacity-80 disabled:opacity-50 whitespace-nowrap"
											>{backfilling === site.id ? '…' : `Backfill (${formatCount(bf.claimable_count)})`}</button>
										{/if}
										{#if sensorCountBySite.get(site.id)}
											<a href="{base}/sites/{site.id}" class="text-xs text-brand-muted no-underline hover:text-brand-primary hover:underline">
												{sensorCountBySite.get(site.id)} sensor{sensorCountBySite.get(site.id) === 1 ? '' : 's'}
											</a>
										{/if}
									</div>
								{:else}
									<span class="text-xs text-brand-muted">None</span>
								{/if}
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<Button
					size="sm"
					onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }}
					disabled={currentPage <= 1}
				>
					Prev
				</Button>
				<span>{currentPage} / {totalPages}</span>
				<Button
					size="sm"
					onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }}
					disabled={currentPage >= totalPages}
				>
					Next
				</Button>
			</div>
		</div>
	{/if}
</div>
