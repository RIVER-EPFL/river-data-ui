<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type Site, type Parameter, type AlarmThreshold } from '$api/crud';
	import { getActiveAlarms, getThresholds, type ResolvedThreshold } from '$api/service';
	import Tabs from '$components/ui/Tabs.svelte';
	import ThresholdDialog from '$components/dialogs/ThresholdDialog.svelte';
	import AlarmEventsPanel from '$components/logs/AlarmEventsPanel.svelte';

	const TABS = ['Log', 'Thresholds'];
	const TAB_KEYS = ['log', 'thresholds'];

	function severityFromString(s: string | null): number | undefined {
		if (s === 'warning' || s === '1') return 1;
		if (s === 'alarm' || s === '2') return 2;
		return undefined;
	}

	// Seed values for the log panel's filters (dashboard / chart-badge links carry ?site_id /
	// ?parameter_id / ?severity). The panel reads these once when it mounts. They're mutable so a
	// Thresholds-row click can re-point them and flip to the Log tab. The panel is unmounted on the
	// Thresholds tab, so switching to Log mounts it fresh with the new seeds (no SvelteKit reuse trap).
	let initialSiteId = $state(page.url.searchParams.get('site_id') ?? '');
	let initialSeverity = $state(severityFromString(page.url.searchParams.get('severity')));
	let initialParameterId = $state(page.url.searchParams.get('parameter_id') ?? '');

	function openLogFor(row: ResolvedThreshold) {
		initialSiteId = row.site_id;
		initialParameterId = row.parameter_id;
		initialSeverity = undefined;
		activeTab = 0;
		const url = new URL(page.url);
		url.searchParams.set('tab', 'log');
		url.searchParams.set('site_id', row.site_id);
		url.searchParams.set('parameter_id', row.parameter_id);
		url.searchParams.delete('severity');
		goto(url, { replaceState: true, noScroll: true });
	}

	function tabFromParam(): number {
		const raw = page.url.searchParams.get('tab');
		// Named ('thresholds') or legacy numeric (old tab=2 was Thresholds).
		if (raw === 'thresholds' || raw === '2') return 1;
		return 0;
	}
	let activeTab = $state<number>(tabFromParam());

	// Keep ?tab in the URL when the user switches tabs (so refresh / back / shared links restore it).
	$effect(() => {
		const t = activeTab;
		untrack(() => {
			const url = new URL(page.url);
			const key = TAB_KEYS[t] ?? 'log';
			if (url.searchParams.get('tab') !== key) {
				url.searchParams.set('tab', key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	// ── Log tab: the event log lives in AlarmEventsPanel; the page hosts its header buttons. ──
	let logPanel = $state<AlarmEventsPanel | undefined>();
	let logEventCount = $state(0);

	// Per-site active counts, shown on each Thresholds row so a site's current load is visible.
	let siteActiveCounts = $state<Map<string, { alarms: number; warnings: number }>>(new Map());

	async function loadActiveCounts() {
		try {
			const result = await getActiveAlarms();
			const m = new Map<string, { alarms: number; warnings: number }>();
			for (const a of result.alarms) {
				const c = m.get(a.site_id) ?? { alarms: 0, warnings: 0 };
				if (a.severity >= 2) c.alarms++;
				else if (a.severity === 1) c.warnings++;
				m.set(a.site_id, c);
			}
			siteActiveCounts = m;
		} catch {
			/* best-effort */
		}
	}

	// ── Thresholds tab ──
	let sites = $state<Site[]>([]);
	let siteMap = $state<Map<string, string>>(new Map());
	let paramMap = $state<Map<string, string>>(new Map());

	let thrSiteFilter = $state<string>('');
	let thrParamFilter = $state<string>('');
	let thresholdDialogOpen = $state(false);
	let thresholdExisting = $state<AlarmThreshold | null>(null);
	let thresholdSiteId = $state<string | null>(null);
	let thresholdParamId = $state<string>('');
	let thresholdParamName = $state<string>('');

	const thresholdParamOptions = $derived([...paramMap].map(([value, label]) => ({ value, label })));
	const thresholdSiteOptions = $derived(sites.map((s) => ({ value: s.id, label: s.name })));

	function openThresholdCreate() {
		thresholdExisting = null;
		thresholdSiteId = null;
		thresholdParamId = '';
		thresholdParamName = '';
		thresholdDialogOpen = true;
	}

	// Effective (resolved) thresholds per sensor - from the backend's single 3-tier definition, so
	// parameter-default thresholds show even with no override row. `rawThresholds` is the underlying
	// alarm_thresholds rows, used to find the override row when editing/resetting.
	let effectiveRows = $state<ResolvedThreshold[]>([]);
	let rawThresholds = $state<AlarmThreshold[]>([]);

	const SOURCE_LABEL: Record<ResolvedThreshold['source'], string> = {
		site: 'Site override',
		global: 'Global',
		default: 'Parameter default',
	};

	const filteredThresholds = $derived(
		effectiveRows
			.filter((r) => !thrSiteFilter || r.site_id === thrSiteFilter)
			.filter((r) => !thrParamFilter || r.parameter_id === thrParamFilter)
			.slice()
			.sort(
				(a, b) =>
					(siteMap.get(a.site_id) ?? '').localeCompare(siteMap.get(b.site_id) ?? '') ||
					(paramMap.get(a.parameter_id) ?? '').localeCompare(paramMap.get(b.parameter_id) ?? ''),
			),
	);

	// One- or two-sided bound shown with comparators. `null` = no bound at all, rendered as a muted
	// "None" so an empty cell reads as intentional rather than a data error.
	function thrBound(min: number | null, max: number | null): string | null {
		if (min == null && max == null) return null;
		if (min == null) return `≤ ${max}`;
		if (max == null) return `≥ ${min}`;
		return `${min} to ${max}`;
	}

	async function loadThresholds() {
		try {
			const [eff, raw] = await Promise.all([
				getThresholds(),
				api.alarmThresholds.list({ perPage: 500 }),
			]);
			effectiveRows = eff;
			rawThresholds = raw.data;
		} catch {
			/* best-effort */
		}
	}

	function openThresholdRow(row: ResolvedThreshold) {
		// Edit the underlying site override if one exists; otherwise open create for this slot.
		thresholdExisting =
			rawThresholds.find((t) => t.parameter_id === row.parameter_id && t.site_id === row.site_id) ??
			null;
		thresholdSiteId = row.site_id;
		thresholdParamId = row.parameter_id;
		thresholdParamName = paramMap.get(row.parameter_id) ?? 'Threshold';
		thresholdDialogOpen = true;
	}

	onMount(async () => {
		loadThresholds();
		loadActiveCounts();
		try {
			const [sitesResult, paramsResult] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = sitesResult.data;
			siteMap = new Map(sitesResult.data.map((s: Site) => [s.id, s.name]));
			paramMap = new Map(paramsResult.data.map((p: Parameter) => [p.id, p.name]));
		} catch {
			/* lookups are best-effort; tables fall back to ids/names */
		}
	});
</script>

<svelte:head><title>Alarms | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-start justify-between">
		<h2 class="text-xl font-semibold">Alarms</h2>
		{#if activeTab === 0}
			<div class="flex items-center gap-2">
				<button
					onclick={() => logPanel?.exportCsv()}
					disabled={logEventCount === 0}
					class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md cursor-pointer hover:bg-brand-bg disabled:opacity-50 disabled:cursor-default"
				>Export CSV</button>
				<button
					onclick={() => logPanel?.rebuild()}
					class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md cursor-pointer hover:bg-brand-bg"
				>Rebuild alarm history</button>
			</div>
		{/if}
	</div>

	<Tabs tabs={TABS} bind:active={activeTab} />

	<!-- ── LOG TAB ── -->
	{#if activeTab === 0}
		<AlarmEventsPanel
			bind:this={logPanel}
			bind:eventCount={logEventCount}
			{initialSiteId}
			{initialSeverity}
			{initialParameterId}
		/>

	<!-- ── THRESHOLDS TAB ── -->
	{:else if activeTab === 1}
		<div class="flex flex-wrap items-center gap-2">
			<select
				bind:value={thrSiteFilter}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value="">All sites</option>
				{#each sites as s}<option value={s.id}>{s.name}</option>{/each}
			</select>
			<select
				bind:value={thrParamFilter}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value="">All parameters</option>
				{#each [...paramMap] as [id, name]}<option value={id}>{name}</option>{/each}
			</select>
			<div class="flex-1"></div>
			<button
				onclick={openThresholdCreate}
				class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm font-semibold cursor-pointer border-none hover:bg-brand-primary-dark"
			>
				Create
			</button>
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Site</th>
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-right px-4 py-2 font-semibold">Current value</th>
						<th class="text-left px-4 py-2 font-semibold">Warning</th>
						<th class="text-left px-4 py-2 font-semibold">Alarm</th>
						<th class="text-left px-4 py-2 font-semibold">Source</th>
						<th class="text-left px-4 py-2 font-semibold">Active (site)</th>
					</tr>
				</thead>
				<tbody>
					{#if filteredThresholds.length === 0}
						<tr><td colspan="7" class="px-4 py-8 text-center text-brand-muted">No thresholds yet. Set parameter defaults or create an override.</td></tr>
					{:else}
						{#each filteredThresholds as row (row.site_id + ':' + row.parameter_id)}
							{@const warn = thrBound(row.warning_min, row.warning_max)}
							{@const alarm = thrBound(row.alarm_min, row.alarm_max)}
							{@const counts = siteActiveCounts.get(row.site_id)}
							<tr onclick={() => openThresholdRow(row)} class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer">
								<td class="px-4 py-2">{siteMap.get(row.site_id) ?? 'Unknown'}</td>
								<td class="px-4 py-2 font-semibold">{paramMap.get(row.parameter_id) ?? 'Unknown'}</td>
								<td class="px-4 py-2 text-right font-mono">{#if row.current_value != null}{row.current_value.toFixed(2)}{:else}<span class="text-brand-muted font-sans">None</span>{/if}</td>
								<td class="px-4 py-2 text-severity-warning">{#if warn}{warn}{:else}<span class="text-brand-muted">None</span>{/if}</td>
								<td class="px-4 py-2 text-severity-alarm">{#if alarm}{alarm}{:else}<span class="text-brand-muted">None</span>{/if}</td>
								<td class="px-4 py-2"><span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">{SOURCE_LABEL[row.source]}</span></td>
								<td class="px-4 py-2">
									{#if counts && (counts.alarms > 0 || counts.warnings > 0)}
										<span class="inline-flex items-center gap-1.5 text-xs">
											{#if counts.alarms > 0}<button type="button" onclick={(e) => { e.stopPropagation(); openLogFor(row); }} class="text-severity-alarm font-medium bg-transparent border-none p-0 cursor-pointer hover:underline">{counts.alarms} alarm</button>{/if}
											{#if counts.alarms > 0 && counts.warnings > 0}<span class="text-brand-muted">·</span>{/if}
											{#if counts.warnings > 0}<button type="button" onclick={(e) => { e.stopPropagation(); openLogFor(row); }} class="text-severity-warning font-medium bg-transparent border-none p-0 cursor-pointer hover:underline">{counts.warnings} warn</button>{/if}
										</span>
									{:else}
										<span class="text-brand-muted">None</span>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<ThresholdDialog
	bind:open={thresholdDialogOpen}
	siteId={thresholdSiteId}
	parameterId={thresholdParamId}
	parameterName={thresholdParamName}
	existing={thresholdExisting}
	parameterOptions={thresholdParamOptions}
	siteOptions={thresholdSiteOptions}
	onsuccess={loadThresholds}
/>
