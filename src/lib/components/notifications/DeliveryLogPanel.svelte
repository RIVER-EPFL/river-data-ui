<script lang="ts">
	import { getNotificationDeliveries, type DeliveryMessage } from '$api/service';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';

	// The delivery log by message: one row per notification, with every attempt it made under it.
	// A message that reached nobody (muted, undeliverable, no recipients) is a row like any other,
	// which is the whole point of reading the log rather than the channel health.

	// The kinds the API writes (messages.rs, triggers.rs, views.rs test-send).
	const KINDS = [
		'alarm_opened',
		'alarm_resolved',
		'stale_data',
		'battery_forecast',
		'sync_failure',
		'sync_stale',
		'test',
	];
	const STATUSES = ['sent', 'failed', 'muted', 'undeliverable', 'skipped'];

	let kind = $state('');
	let status = $state('');
	let expanded = $state<Set<string>>(new Set());

	const hasFilters = $derived(Boolean(kind || status));

	const columns: Column[] = [
		{ key: 'at', label: 'Time', sortable: false, class: 'whitespace-nowrap text-brand-muted' },
		{ key: 'kind', label: 'Kind', sortable: false },
		{ key: 'scope', label: 'Scope', sortable: false, class: 'text-brand-muted' },
		{ key: 'outcome', label: 'Outcome', sortable: false },
		{ key: 'recipients', label: 'Recipients', sortable: false },
	];

	function key(m: DeliveryMessage): string {
		return `${m.alarmEventId ?? '-'}|${m.kind}|${m.at}`;
	}

	function scope(m: DeliveryMessage): string {
		return [m.siteName, m.parameterName].filter(Boolean).join(' · ');
	}

	function outcomes(m: DeliveryMessage): { label: string; variant: 'ok' | 'alarm' | 'muted' }[] {
		const c = m.counts;
		const out: { label: string; variant: 'ok' | 'alarm' | 'muted' }[] = [];
		if (c.sent > 0) out.push({ label: `${c.sent} sent`, variant: 'ok' });
		if (c.failed > 0) out.push({ label: `${c.failed} failed`, variant: 'alarm' });
		if (c.muted > 0) out.push({ label: `${c.muted} muted`, variant: 'muted' });
		if (c.undeliverable > 0) out.push({ label: `${c.undeliverable} undeliverable`, variant: 'alarm' });
		if (c.skipped > 0) out.push({ label: `${c.skipped} skipped`, variant: 'muted' });
		return out;
	}

	async function loadDeliveries({ page, perPage }: PageRequest) {
		expanded = new Set();
		const r = await getNotificationDeliveries({
			limit: perPage,
			offset: (page - 1) * perPage,
			kind: kind || undefined,
			status: status || undefined,
		});
		return { data: r.messages, total: r.total };
	}

	function toggle(m: DeliveryMessage) {
		const next = new Set(expanded);
		const k = key(m);
		if (next.has(k)) next.delete(k);
		else next.add(k);
		expanded = next;
	}

	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30';
</script>

<CrudList
	load={loadDeliveries}
	{columns}
	title="Delivery log"
	showHeader={false}
	emptyText={hasFilters
		? 'No deliveries match those filters.'
		: 'No deliveries yet. Messages appear here once an alarm fires or you send a test.'}
>
	{#snippet filterBar({ reload }: { reload: () => void })}
		<div class="flex flex-wrap items-end gap-3">
			<label class="flex flex-col gap-1 text-xs text-brand-muted">
				Kind
				<select bind:value={kind} onchange={reload} class={selectCls}>
					<option value="">Any</option>
					{#each KINDS as k (k)}
						<option value={k}>{k}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-xs text-brand-muted">
				Status
				<select bind:value={status} onchange={reload} class={selectCls}>
					<option value="">Any</option>
					{#each STATUSES as s (s)}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</label>
			<p class="text-xs text-brand-muted">
				Web Push reports that the push service accepted a message or that a subscription is dead. It
				never reports arrival on the device.
			</p>
		</div>
	{/snippet}

	{#snippet cell({ column, row, text }: { column: Column; row: DeliveryMessage; text: string })}
		{#if column.key === 'at'}
			{formatDateTime(row.at)}
		{:else if column.key === 'scope'}
			{scope(row) || '-'}
		{:else if column.key === 'outcome'}
			<span class="flex flex-wrap gap-1">
				{#each outcomes(row) as o (o.label)}
					<Badge variant={o.variant === 'muted' ? 'default' : o.variant}>{o.label}</Badge>
				{/each}
			</span>
		{:else if column.key === 'recipients'}
			<button
				class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
				onclick={() => toggle(row)}
				>{expanded.has(key(row)) ? 'Hide' : 'Show'}
				{row.counts.total} recipient{row.counts.total === 1 ? '' : 's'}</button
			>
		{:else}
			{text}
		{/if}
	{/snippet}

	{#snippet rowDetail({ row, colCount }: { row: DeliveryMessage; colCount: number })}
		{#if expanded.has(key(row))}
			<tr class="border-b border-brand-divider bg-brand-bg last:border-b-0">
				<td colspan={colCount} class="px-4 py-2">
					<table class="w-full text-xs">
						<thead class="text-brand-muted">
							<tr>
								<th class="py-1 pr-3 text-left font-medium">Channel</th>
								<th class="py-1 pr-3 text-left font-medium">Recipient</th>
								<th class="py-1 pr-3 text-left font-medium">Status</th>
								<th class="py-1 text-left font-medium">Error</th>
							</tr>
						</thead>
						<tbody>
							{#each row.recipients as r (r.channel + r.recipient + r.createdAt)}
								<tr>
									<td class="py-1 pr-3">{r.channel}</td>
									<td class="py-1 pr-3 font-mono break-all">{r.recipient}</td>
									<td class="py-1 pr-3">
										{#if r.status === 'sent'}<Badge variant="ok">sent</Badge>
										{:else if r.status === 'failed'}<Badge variant="alarm">failed</Badge>
										{:else}<Badge variant="default">{r.status}</Badge>{/if}
									</td>
									<td class="py-1 text-brand-muted">{r.error ?? '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</td>
			</tr>
		{/if}
	{/snippet}
</CrudList>
