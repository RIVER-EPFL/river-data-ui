<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, type Site, type Parameter } from '$api/crud';
	import {
		getAlarmEvents,
		acknowledgeAlarm,
		unacknowledgeAlarm,
		rebuildAlarmEvents,
		type AlarmEvent,
	} from '$api/service';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { alarmHref, severityLabel } from '$lib/alarms';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import Button from '$components/ui/Button.svelte';

	let {
		initialSiteId = '',
		initialSeverity = undefined,
		initialParameterId = '',
		eventCount = $bindable(0),
	}: {
		initialSiteId?: string;
		initialSeverity?: number;
		initialParameterId?: string;
		eventCount?: number;
	} = $props();

	const EVENTS_PAGE_SIZE = 100;

	// Filter state, owned by this panel (the page owns the ?tab URL param, not us).
	let siteFilter = $state<string>(initialSiteId);
	let severityFilter = $state<number | undefined>(initialSeverity);
	let statusFilter = $state<string>('all');
	let eventParamFilter = $state<string>(initialParameterId);
	let eventStart = $state<string>('');
	let eventEnd = $state<string>('');
	let eventOffset = $state(0);

	let events = $state<AlarmEvent[]>([]);
	let eventsTotal = $state(0);
	let eventsLoading = $state(true);
	let eventsError = $state<string | null>(null);

	let sites = $state<Site[]>([]);
	let paramMap = $state<Map<string, string>>(new Map());

	const eventsPage = $derived(Math.floor(eventOffset / EVENTS_PAGE_SIZE) + 1);

	function startIso(d: string): string | undefined {
		return d ? `${d}T00:00:00Z` : undefined;
	}
	function endIso(d: string): string | undefined {
		return d ? `${d}T23:59:59Z` : undefined;
	}

	async function loadEvents() {
		eventsLoading = true;
		eventsError = null;
		try {
			const result = await getAlarmEvents({
				site_id: siteFilter || undefined,
				severity: severityFilter,
				status: statusFilter,
				parameter_id: eventParamFilter || undefined,
				start: startIso(eventStart),
				end: endIso(eventEnd),
				limit: EVENTS_PAGE_SIZE,
				offset: eventOffset,
			});
			events = result.events;
			eventsTotal = result.total;
			eventCount = events.length;
		} catch (e) {
			eventsError = e instanceof Error ? e.message : 'Failed to load alarm events';
		} finally {
			eventsLoading = false;
		}
	}

	function onFiltersChanged() {
		eventOffset = 0;
		loadEvents();
	}

	function severityDot(n: number): string {
		return n >= 2 ? 'bg-severity-alarm' : 'bg-severity-warning';
	}

	function exportEventsCsv() {
		const header = ['Site', 'Parameter', 'Severity', 'Started', 'Last seen', 'Status', 'Last value', 'Resolved at'];
		const escape = (v: unknown): string => {
			const s = v == null ? '' : String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const rows = events.map((e) => {
			const sev = e.max_severity ?? e.severity;
			return [
				e.site_name,
				e.parameter_name,
				severityLabel(sev),
				e.started_at,
				e.last_seen_at,
				e.resolved_at ? 'Resolved' : 'Open',
				e.last_value != null ? e.last_value : '',
				e.resolved_at ?? '',
			];
		});
		const csv = [header, ...rows].map((r) => r.map(escape).join(',')).join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `alarm-events-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleRebuildEvents() {
		try {
			await rebuildAlarmEvents({
				site_id: siteFilter || undefined,
				parameter_id: eventParamFilter || undefined,
				start: startIso(eventStart),
				end: endIso(eventEnd),
			});
			toastStore.success('Rebuild started');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to start rebuild');
		}
	}

	// Exposed to the parent (via bind:this) so the service buttons can live in the page header.
	export function exportCsv() {
		exportEventsCsv();
	}
	export function rebuild() {
		handleRebuildEvents();
	}

	async function handleAcknowledge(eventId: string) {
		try {
			await acknowledgeAlarm(eventId);
			await loadEvents();
		} catch (e) {
			eventsError = e instanceof Error ? e.message : 'Failed to acknowledge';
		}
	}

	async function handleUnacknowledge(eventId: string) {
		try {
			await unacknowledgeAlarm(eventId);
			await loadEvents();
		} catch (e) {
			eventsError = e instanceof Error ? e.message : 'Failed to unacknowledge';
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

	onMount(async () => {
		loadEvents();
		try {
			const [sitesResult, paramsResult] = await Promise.all([
				api.sites.list({ perPage: 200 }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = sitesResult.data;
			paramMap = new Map(paramsResult.data.map((p: Parameter) => [p.id, p.name]));
		} catch {
			/* lookups are best-effort; tables fall back to ids/names from events */
		}
	});
</script>

<div class="space-y-4">
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
			bind:value={eventParamFilter}
			onchange={onFiltersChanged}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="">All parameters</option>
			{#each [...paramMap] as [id, name]}<option value={id}>{name}</option>{/each}
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
		<select
			bind:value={statusFilter}
			onchange={onFiltersChanged}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value="all">All</option>
			<option value="open">Open</option>
			<option value="resolved">Resolved</option>
		</select>
		<label class="flex items-center gap-1 text-sm text-brand-muted">
			From
			<input
				type="date"
				bind:value={eventStart}
				onchange={onFiltersChanged}
				class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</label>
		<label class="flex items-center gap-1 text-sm text-brand-muted">
			To
			<input
				type="date"
				bind:value={eventEnd}
				onchange={onFiltersChanged}
				class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</label>
	</div>

	{#if eventsError}
		<p class="text-severity-alarm">{eventsError}</p>
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Site</th>
					<th class="text-left px-4 py-2 font-semibold">Parameter</th>
					<th class="text-left px-4 py-2 font-semibold">Severity</th>
					<th class="text-right px-4 py-2 font-semibold">Started</th>
					<th class="text-right px-4 py-2 font-semibold">Duration</th>
					<th class="text-right px-4 py-2 font-semibold">Last seen</th>
					<th class="text-left px-4 py-2 font-semibold">Status</th>
					<th class="text-right px-4 py-2 font-semibold">Last value</th>
					<th class="px-4 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#if eventsLoading}
					<tr><td colspan="9" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if events.length === 0}
					<tr><td colspan="9" class="px-4 py-8 text-center text-brand-muted">No alarm events</td></tr>
				{:else}
					{#each events as event (event.id)}
						{@const sev = event.max_severity ?? event.severity}
						<tr onclick={() => goto(alarmHref(event))} title="Open this alarm period on the site charts" class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer">
							<td class="px-4 py-2">
								<a href={alarmHref(event)} onclick={(e) => e.stopPropagation()} class="text-brand-primary font-semibold no-underline hover:underline">{event.site_name}</a>
							</td>
							<td class="px-4 py-2">{event.parameter_name}</td>
							<td class="px-4 py-2">
								<span class="inline-flex items-center gap-1.5">
									<span class="inline-block w-2.5 h-2.5 rounded-full {severityDot(sev)}"></span>
									{severityLabel(sev)}
								</span>
							</td>
							<td class="px-4 py-2 text-right text-brand-muted" title={formatDateTime(event.started_at)}>{formatRelativeTime(event.started_at)}</td>
							<td class="px-4 py-2 text-right text-brand-muted">{formatDuration(event.started_at, event.resolved_at)}</td>
							<td class="px-4 py-2 text-right text-brand-muted" title={formatDateTime(event.last_seen_at)}>{formatRelativeTime(event.last_seen_at)}</td>
							<td class="px-4 py-2">
								{#if event.resolved_at}
									<span class="text-severity-ok">Resolved <span class="text-brand-muted">{formatDateTime(event.resolved_at)}</span></span>
								{:else}
									<span class="text-severity-alarm">Open</span>
									<span class="text-brand-muted">since {formatDateTime(event.started_at)}</span>
									{#if event.acknowledged_at}
										<span class="text-brand-muted ml-1" title={formatDateTime(event.acknowledged_at)}>ack'd</span>
									{/if}
								{/if}
							</td>
							<td class="px-4 py-2 text-right font-mono">
								{#if event.last_value != null}{event.last_value.toFixed(2)}{:else}<span class="text-brand-muted">None</span>{/if}
							</td>
							<td class="px-4 py-2 text-right">
								{#if !event.resolved_at && !event.acknowledged_at}
									<Button
										variant="ghost"
										size="sm"
										onclick={(e) => { e.stopPropagation(); handleAcknowledge(event.id); }}
										class="text-brand-primary"
									>Acknowledge</Button>
								{:else if !event.resolved_at && event.acknowledged_at}
									<Button
										variant="ghost"
										size="sm"
										onclick={(e) => { e.stopPropagation(); handleUnacknowledge(event.id); }}
									>Unacknowledge</Button>
								{/if}
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls
		total={eventsTotal}
		page={eventsPage}
		perPage={EVENTS_PAGE_SIZE}
		onPageChange={(p) => { eventOffset = (p - 1) * EVENTS_PAGE_SIZE; loadEvents(); }}
	/>
</div>
