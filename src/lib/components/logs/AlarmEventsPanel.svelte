<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Parameter } from '$api/crud';
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
	import Button from '$components/ui/Button.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import { formatMeasurement } from '$lib/format';

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

	let events = $state<AlarmEvent[]>([]);
	let list = $state<ReturnType<typeof CrudList> | null>(null);

	let paramMap = $state<Map<string, string>>(new Map());

	const columns: Column[] = [
		{ key: 'site_name', label: 'Site', sortable: false },
		{ key: 'parameter_name', label: 'Parameter', sortable: false },
		{ key: 'severity', label: 'Severity', sortable: false },
		{ key: 'started_at', label: 'Started', sortable: false, class: 'text-right text-brand-muted' },
		{ key: 'duration', label: 'Duration', sortable: false, class: 'text-right text-brand-muted' },
		{ key: 'last_seen_at', label: 'Last seen', sortable: false, class: 'text-right text-brand-muted' },
		{ key: 'status', label: 'Status', sortable: false },
		{ key: 'last_value', label: 'Last value', sortable: false, class: 'text-right font-mono' },
	];

	function startIso(d: string): string | undefined {
		return d ? `${d}T00:00:00Z` : undefined;
	}
	function endIso(d: string): string | undefined {
		return d ? `${d}T23:59:59Z` : undefined;
	}

	async function loadEvents({ page, perPage }: PageRequest) {
		const result = await getAlarmEvents({
			site_id: siteFilter || undefined,
			severity: severityFilter,
			status: statusFilter,
			parameter_id: eventParamFilter || undefined,
			start: startIso(eventStart),
			end: endIso(eventEnd),
			limit: perPage,
			offset: (page - 1) * perPage,
		});
		events = result.events;
		eventCount = result.events.length;
		return { data: result.events, total: result.total };
	}

	function severityDot(n: number): string {
		return n >= 2 ? 'bg-severity-alarm' : 'bg-severity-warning-fill';
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
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to acknowledge');
		}
		list?.refresh();
	}

	async function handleUnacknowledge(eventId: string) {
		try {
			await unacknowledgeAlarm(eventId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to unacknowledge');
		}
		list?.refresh();
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
		try {
			const paramsResult = await api.parameters.list({ perPage: 500 });
			paramMap = new Map(paramsResult.data.map((p: Parameter) => [p.id, p.name]));
		} catch {
			/* lookups are best-effort; tables fall back to ids/names from events */
		}
	});

	const selectCls = 'px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm';
</script>

<CrudList
	bind:this={list}
	load={loadEvents}
	{columns}
	title="Alarm events"
	showHeader={false}
	perPage={EVENTS_PAGE_SIZE}
	emptyText="No alarm events"
	actions={rowActions}
	rowHref={(e: AlarmEvent) => alarmHref(e)}
>
	{#snippet filterBar({ reload }: { reload: () => void })}
		<SiteSelect bind:value={siteFilter} onchange={reload} placeholder="All sites" />
		<select bind:value={eventParamFilter} onchange={reload} class={selectCls}>
			<option value="">All parameters</option>
			{#each [...paramMap] as [id, name]}<option value={id}>{name}</option>{/each}
		</select>
		<select bind:value={severityFilter} onchange={reload} class={selectCls}>
			<option value={undefined}>All severities</option>
			<option value={1}>Warning</option>
			<option value={2}>Alarm</option>
		</select>
		<select bind:value={statusFilter} onchange={reload} class={selectCls}>
			<option value="all">All</option>
			<option value="open">Open</option>
			<option value="resolved">Resolved</option>
		</select>
		<label class="flex items-center gap-1 text-sm text-brand-muted">
			From
			<input type="date" bind:value={eventStart} onchange={reload} class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
		</label>
		<label class="flex items-center gap-1 text-sm text-brand-muted">
			To
			<input type="date" bind:value={eventEnd} onchange={reload} class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
		</label>
	{/snippet}

	{#snippet cell({ column, row, text }: { column: Column; row: AlarmEvent; text: string })}
		{#if column.key === 'severity'}
			{@const sev = row.max_severity ?? row.severity}
			<span class="inline-flex items-center gap-1.5">
				<span class="inline-block w-2.5 h-2.5 rounded-full {severityDot(sev)}"></span>
				{severityLabel(sev)}
			</span>
		{:else if column.key === 'started_at'}
			<span title={formatDateTime(row.started_at)}>{formatRelativeTime(row.started_at)}</span>
		{:else if column.key === 'duration'}
			{formatDuration(row.started_at, row.resolved_at)}
		{:else if column.key === 'last_seen_at'}
			<span title={formatDateTime(row.last_seen_at)}>{formatRelativeTime(row.last_seen_at)}</span>
		{:else if column.key === 'status'}
			{#if row.resolved_at}
				<span class="text-severity-ok">Resolved <span class="text-brand-muted">{formatDateTime(row.resolved_at)}</span></span>
			{:else}
				<span class="text-severity-alarm">Open</span>
				<span class="text-brand-muted">since {formatDateTime(row.started_at)}</span>
				{#if row.acknowledged_at}
					<span class="text-brand-muted ml-1" title={formatDateTime(row.acknowledged_at)}>ack'd</span>
				{/if}
			{/if}
		{:else if column.key === 'last_value'}
			{formatMeasurement(row.last_value)}
		{:else}
			{text}
		{/if}
	{/snippet}
</CrudList>

{#snippet rowActions(event: AlarmEvent)}
	<div class="text-right">
		{#if !event.resolved_at && !event.acknowledged_at}
			<Button
				variant="ghost"
				size="sm"
				onclick={() => handleAcknowledge(event.id)}
				class="text-brand-primary"
			>Acknowledge</Button>
		{:else if !event.resolved_at && event.acknowledged_at}
			<Button variant="ghost" size="sm" onclick={() => handleUnacknowledge(event.id)}>Unacknowledge</Button>
		{/if}
	</div>
{/snippet}
