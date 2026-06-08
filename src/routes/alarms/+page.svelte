<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type Site, type Parameter, type AlarmThreshold } from '$api/crud';
	import {
		getActiveAlarms,
		acknowledgeAlarm,
		unacknowledgeAlarm,
		type ActiveAlarm,
	} from '$api/service';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import ThresholdDialog from '$components/dialogs/ThresholdDialog.svelte';

	const TABS = ['Active', 'Thresholds'];
	const TAB_KEYS = ['active', 'thresholds'];

	function severityFromString(s: string | null): number | undefined {
		if (s === 'warning') return 1;
		if (s === 'alarm') return 2;
		return undefined;
	}

	function severityToString(n: number | undefined): string {
		if (n === 1) return 'warning';
		if (n === 2) return 'alarm';
		return '';
	}

	// ── Filter state (reflected to/from URL) ──
	let siteFilter = $state<string>(page.url.searchParams.get('site_id') ?? '');
	let severityFilter = $state<number | undefined>(
		severityFromString(page.url.searchParams.get('severity')),
	);

	function tabFromParam(): number {
		const raw = page.url.searchParams.get('tab');
		// Named ('thresholds') or legacy numeric (old tab=2 was Thresholds).
		if (raw === 'thresholds' || raw === '2') return 1;
		return 0;
	}
	let activeTab = $state<number>(tabFromParam());

	function syncUrl() {
		const url = new URL(page.url);
		if (siteFilter) url.searchParams.set('site_id', siteFilter);
		else url.searchParams.delete('site_id');
		const sevStr = severityToString(severityFilter);
		if (sevStr) url.searchParams.set('severity', sevStr);
		else url.searchParams.delete('severity');
		url.searchParams.set('tab', TAB_KEYS[activeTab] ?? 'active');
		goto(url, { replaceState: true, noScroll: true });
	}

	// Keep ?tab in the URL when the user switches tabs manually (so refresh / back / shared
	// links restore the tab). Depends only on activeTab; URL/filter reads are untracked to
	// avoid feedback loops.
	$effect(() => {
		const t = activeTab;
		untrack(() => {
			const url = new URL(page.url);
			const key = TAB_KEYS[t] ?? 'active';
			if (url.searchParams.get('tab') !== key) {
				url.searchParams.set('tab', key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	// Link to the full alarm event history (now in the unified Logs page), carrying filters.
	function eventHistoryHref(): string {
		const params = new URLSearchParams({ tab: 'alarms' });
		if (siteFilter) params.set('site_id', siteFilter);
		const sev = severityToString(severityFilter);
		if (sev) params.set('severity', sev);
		return `${base}/logs?${params}`;
	}

	// ── Shared lookups ──
	let sites = $state<Site[]>([]);

	// ── Active tab ──
	let activeAlarms = $state<ActiveAlarm[]>([]);
	let activeLoading = $state(true);
	let activeError = $state<string | null>(null);

	const filteredActive = $derived(
		activeAlarms.filter((a) => {
			if (siteFilter && a.site_id !== siteFilter) return false;
			if (severityFilter && a.severity !== severityFilter) return false;
			return true;
		}),
	);

	async function loadActive() {
		activeLoading = true;
		activeError = null;
		try {
			const result = await getActiveAlarms();
			activeAlarms = result.alarms;
		} catch (e) {
			activeError = e instanceof Error ? e.message : 'Failed to load active alarms';
		} finally {
			activeLoading = false;
		}
	}

	function onFiltersChanged() {
		syncUrl();
	}

	async function handleAcknowledgeActive(eventId: string) {
		try {
			await acknowledgeAlarm(eventId);
			await loadActive();
		} catch (e) {
			activeError = e instanceof Error ? e.message : 'Failed to acknowledge';
		}
	}

	async function handleUnacknowledgeActive(eventId: string) {
		try {
			await unacknowledgeAlarm(eventId);
			await loadActive();
		} catch (e) {
			activeError = e instanceof Error ? e.message : 'Failed to unacknowledge';
		}
	}

	function formatDuration(from: string, to?: string | null): string {
		const start = new Date(from).getTime();
		const end = to ? new Date(to).getTime() : Date.now();
		const ms = end - start;
		const minutes = Math.floor(ms / 60_000);
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ${minutes % 60}m`;
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}

	function severityLabel(n: number): string {
		return n >= 2 ? 'Alarm' : 'Warning';
	}
	function severityDot(n: number): string {
		return n >= 2 ? 'bg-severity-alarm' : 'bg-severity-warning';
	}

	// ── Thresholds tab ──
	let siteMap = $state<Map<string, string>>(new Map());
	let paramMap = $state<Map<string, string>>(new Map());

	let thrSiteFilter = $state<string>('');
	let thrParamFilter = $state<string>('');
	let thresholdList = $state<CrudList | undefined>();
	let thresholdDialogOpen = $state(false);
	let thresholdExisting = $state<AlarmThreshold | null>(null);
	let thresholdSiteId = $state<string | null>(null);
	let thresholdParamId = $state<string>('');
	let thresholdParamName = $state<string>('');

	const thresholdParamOptions = $derived([...paramMap].map(([value, label]) => ({ value, label })));
	const thresholdSiteOptions = $derived(sites.map((s) => ({ value: s.id, label: s.name })));

	function openThresholdEdit(row: AlarmThreshold) {
		thresholdExisting = row;
		thresholdSiteId = row.site_id;
		thresholdParamId = row.parameter_id ?? '';
		thresholdParamName = (row.parameter_id ? paramMap.get(row.parameter_id) : undefined) ?? 'Threshold';
		thresholdDialogOpen = true;
	}

	function openThresholdCreate() {
		thresholdExisting = null;
		thresholdSiteId = null;
		thresholdParamId = '';
		thresholdParamName = '';
		thresholdDialogOpen = true;
	}

	onMount(async () => {
		loadActive();
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
	<h2 class="text-xl font-semibold">Alarms</h2>

	<Tabs tabs={TABS} bind:active={activeTab} />

	<!-- ── ACTIVE TAB ── -->
	{#if activeTab === 0}
		<div class="flex flex-wrap items-center gap-2">
			<select
				bind:value={siteFilter}
				onchange={onFiltersChanged}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value="">All sites</option>
				{#each sites as s}<option value={s.id}>{s.name}</option>{/each}
			</select>
			<select
				bind:value={severityFilter}
				onchange={onFiltersChanged}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value={undefined}>All severities</option>
				<option value={1}>Warning</option>
				<option value={2}>Alarm</option>
			</select>
			<div class="flex-1"></div>
			<a
				href={eventHistoryHref()}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm no-underline text-brand-primary hover:bg-brand-bg"
			>View full event history →</a>
		</div>

		{#if activeError}
			<p class="text-severity-alarm">{activeError}</p>
		{/if}

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Site</th>
						<th class="text-left px-4 py-2 font-semibold">Parameter</th>
						<th class="text-right px-4 py-2 font-semibold">Value</th>
						<th class="text-left px-4 py-2 font-semibold">Severity</th>
						<th class="text-right px-4 py-2 font-semibold">Duration</th>
						<th class="px-4 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#if activeLoading}
						<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading...</td></tr>
					{:else if filteredActive.length === 0}
						<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No active alarms</td></tr>
					{:else}
						{#each filteredActive as alarm (alarm.site_id + ':' + alarm.parameter_id)}
							<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50">
								<td class="px-4 py-2">
									<a href="{base}/sites/{alarm.site_id}" class="text-brand-primary font-semibold no-underline hover:underline">{alarm.site_name}</a>
								</td>
								<td class="px-4 py-2">{alarm.parameter_name}</td>
								<td class="px-4 py-2 text-right font-mono">{alarm.current_value}</td>
								<td class="px-4 py-2">
									<span class="inline-flex items-center gap-1.5">
										<span class="inline-block w-2.5 h-2.5 rounded-full {severityDot(alarm.severity)}"></span>
										{severityLabel(alarm.severity)}
										{#if alarm.acknowledged}
											<span class="text-brand-muted text-[10px]">ack'd</span>
										{/if}
									</span>
								</td>
								<td class="px-4 py-2 text-right text-brand-muted" title={alarm.started_at ? `Last reading: ${formatRelativeTime(alarm.since)}` : formatDateTime(alarm.since)}>
									{#if alarm.started_at}
										{formatDuration(alarm.started_at)}
									{:else}
										{formatRelativeTime(alarm.since)}
									{/if}
								</td>
								<td class="px-4 py-2 text-right">
									{#if alarm.acknowledged && alarm.event_id}
										<button
											onclick={() => handleUnacknowledgeActive(alarm.event_id!)}
											class="text-xs text-brand-muted bg-transparent border-none cursor-pointer hover:underline"
										>Unacknowledge</button>
									{:else if !alarm.acknowledged && alarm.event_id}
										<button
											onclick={() => handleAcknowledgeActive(alarm.event_id!)}
											class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline"
										>Acknowledge</button>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>

	<!-- ── THRESHOLDS TAB ── -->
	{:else if activeTab === 1}
		<div class="flex flex-wrap items-center gap-2">
			<select
				bind:value={thrSiteFilter}
				onchange={() => thresholdList?.refresh()}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value="">All sites</option>
				{#each sites as s}<option value={s.id}>{s.name}</option>{/each}
			</select>
			<select
				bind:value={thrParamFilter}
				onchange={() => thresholdList?.refresh()}
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

		<CrudList
			bind:this={thresholdList}
			client={api.alarmThresholds}
			title="Alarm Thresholds"
			filters={{ ...(thrParamFilter ? { parameter_id: thrParamFilter } : {}), ...(thrSiteFilter ? { site_id: thrSiteFilter } : {}) }}
			columns={[
				{ key: 'parameter_id', label: 'Parameter', render: (_, row) => row.parameter_id ? paramMap.get(row.parameter_id) ?? '—' : '—' },
				{ key: 'site_id', label: 'Site', render: (_, row) => row.site_id ? siteMap.get(row.site_id) ?? '—' : 'Global default' },
				{ key: 'warning_min', label: 'W Min' },
				{ key: 'warning_max', label: 'W Max' },
				{ key: 'alarm_min', label: 'A Min' },
				{ key: 'alarm_max', label: 'A Max' },
			]}
			onrowclick={openThresholdEdit}
		/>
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
	onsuccess={() => thresholdList?.refresh()}
/>
