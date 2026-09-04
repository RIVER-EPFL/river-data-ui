<script lang="ts">
	import {
		getNotificationDeliveries,
		type DeliveryMessage,
	} from '$api/service';
	import { formatDateTime } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	// The delivery log by message: one row per notification, with every attempt it made under it.
	// A message that reached nobody (muted, undeliverable, no recipients) is a row like any other,
	// which is the whole point of reading the log rather than the channel health.

	const PER_PAGE = 25;

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

	let messages = $state<DeliveryMessage[]>([]);
	let total = $state(0);
	let page = $state(1);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let kind = $state('');
	let status = $state('');
	let expanded = $state<Set<string>>(new Set());

	const hasFilters = $derived(Boolean(kind || status));

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

	async function load() {
		loading = true;
		error = null;
		try {
			const r = await getNotificationDeliveries({
				limit: PER_PAGE,
				offset: (page - 1) * PER_PAGE,
				kind: kind || undefined,
				status: status || undefined,
			});
			messages = r.messages;
			total = r.total;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the delivery log';
			messages = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function applyFilters() {
		page = 1;
		expanded = new Set();
		void load();
	}

	function toggle(m: DeliveryMessage) {
		const next = new Set(expanded);
		const k = key(m);
		if (next.has(k)) next.delete(k);
		else next.add(k);
		expanded = next;
	}

	$effect(() => {
		void load();
	});

	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30';
</script>

<div class="flex flex-col gap-3">
	<div class="flex flex-wrap items-end gap-3">
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Kind
			<select bind:value={kind} onchange={applyFilters} class={selectCls}>
				<option value="">Any</option>
				{#each KINDS as k (k)}
					<option value={k}>{k}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Status
			<select bind:value={status} onchange={applyFilters} class={selectCls}>
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

	{#if error}
		<ErrorNotice message={error} />
	{/if}

	<div class="overflow-x-auto rounded-md border border-brand-divider bg-brand-surface">
		<table class="w-full text-sm">
			<thead>
				<tr class="border-b border-brand-divider bg-brand-bg">
					<th class="px-4 py-2 text-left font-semibold">Time</th>
					<th class="px-4 py-2 text-left font-semibold">Kind</th>
					<th class="px-4 py-2 text-left font-semibold">Scope</th>
					<th class="px-4 py-2 text-left font-semibold">Outcome</th>
					<th class="px-4 py-2 text-left font-semibold">Recipients</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="5" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if messages.length === 0}
					<tr
						><td colspan="5" class="px-4 py-8 text-center text-brand-muted">
							{hasFilters
								? 'No deliveries match those filters.'
								: 'No deliveries yet. Messages appear here once an alarm fires or you send a test.'}
						</td></tr
					>
				{:else}
					{#each messages as m (key(m))}
						<tr class="border-b border-brand-divider last:border-b-0">
							<td class="whitespace-nowrap px-4 py-2 text-brand-muted">{formatDateTime(m.at)}</td>
							<td class="px-4 py-2">{m.kind}</td>
							<td class="px-4 py-2 text-brand-muted">{scope(m) || '-'}</td>
							<td class="px-4 py-2">
								<span class="flex flex-wrap gap-1">
									{#each outcomes(m) as o (o.label)}
										<Badge variant={o.variant === 'muted' ? 'default' : o.variant}>{o.label}</Badge>
									{/each}
								</span>
							</td>
							<td class="px-4 py-2">
								<button
									class="cursor-pointer border-none bg-transparent p-0 text-brand-primary hover:underline"
									onclick={() => toggle(m)}
									>{expanded.has(key(m)) ? 'Hide' : 'Show'}
									{m.counts.total} recipient{m.counts.total === 1 ? '' : 's'}</button
								>
							</td>
						</tr>
						{#if expanded.has(key(m))}
							<tr class="border-b border-brand-divider bg-brand-bg last:border-b-0">
								<td colspan="5" class="px-4 py-2">
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
											{#each m.recipients as r (r.channel + r.recipient + r.createdAt)}
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
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls
		{total}
		{page}
		perPage={PER_PAGE}
		onPageChange={(p) => {
			page = p;
			expanded = new Set();
			void load();
		}}
	/>
</div>
