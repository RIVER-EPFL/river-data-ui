<script lang="ts">
	import { base } from '$app/paths';
	import { listReplicateAudits, resolveReplicateAudit, type ReplicateAuditHold } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import { KIND_LABEL, KIND_STYLE, KIND_TIP, VERIFICATION_KINDS } from '$lib/holds';
	import { apiMessage } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import EventPanel from '$components/logs/EventPanel.svelte';

	// What an intern entered and a manager has not ruled on: the field days themselves (Q177) and
	// the values entered in them.
	let ruling = $state(false);
	let reason = $state('');

	async function loadPage({ page, perPage }: { page: number; perPage: number }) {
		const r = await listReplicateAudits({
			page,
			page_size: perPage,
			status: 'pending',
			kind: VERIFICATION_KINDS.join(','),
		});
		return { data: r.holds, total: r.total };
	}

	function enteredBy(hold: ReplicateAuditHold): string {
		const computed = hold.computed as { entered_by?: string } | null;
		return computed?.entered_by ?? '-';
	}

	async function rule(
		hold: ReplicateAuditHold,
		mode: 'verify' | 'reject',
		ctx: { close: () => void; reload: () => Promise<void> },
	) {
		ruling = true;
		try {
			const res = await resolveReplicateAudit(
				hold.id,
				mode === 'verify'
					? { mode: 'verify' }
					: { mode: 'reject', ...(reason.trim() ? { reason: reason.trim() } : {}) },
			);
			const withdrawn = res.samples_affected ?? 0;
			if (hold.kind === 'unverified_visit') {
				toastStore.success(
					mode === 'verify'
						? 'Field day verified: its measurements are still verified one by one'
						: `Field day rejected: ${withdrawn} reading${withdrawn === 1 ? '' : 's'} withdrawn with it`,
				);
			} else {
				toastStore.success(
					mode === 'verify'
						? 'Verified: the value is served as it stands'
						: 'Rejected: the value is withdrawn and stays on the record',
				);
			}
			reason = '';
			ctx.close();
			await ctx.reload();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			ruling = false;
		}
	}
</script>

<EventPanel
	load={loadPage}
	perPage={100}
	colCount={5}
	emptyText="Nothing is waiting for verification"
	detailTitle="Pending verification"
	onOpenDetail={() => { reason = ''; }}
>
	{#snippet head()}
		<th class="text-left px-4 py-2 font-semibold">Date</th>
		<th class="text-left px-4 py-2 font-semibold">Site</th>
		<th class="text-left px-4 py-2 font-semibold">What</th>
		<th class="text-left px-4 py-2 font-semibold">Entered by</th>
		<th class="text-left px-4 py-2 font-semibold"><span class="sr-only">Visit</span></th>
	{/snippet}
	{#snippet row(hold)}
		<td class="px-4 py-2 text-xs whitespace-nowrap">{formatDateTime(hold.group_time)}</td>
		<td class="px-4 py-2 text-xs">{hold.site_name ?? '-'}</td>
		<td class="px-4 py-2 text-xs">
			<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {KIND_STYLE[hold.kind]}" title={KIND_TIP[hold.kind]}>
				{KIND_LABEL[hold.kind]}
			</span>
			{#if hold.kind === 'unverified_entry'}
				<span class="ml-1">{hold.parameter_name ?? hold.parameter_code ?? ''}</span>
			{/if}
		</td>
		<td class="px-4 py-2 text-xs text-brand-muted">{enteredBy(hold)}</td>
		<td class="px-4 py-2 text-xs whitespace-nowrap">
			{#if hold.site_id}
				<a
					class="text-brand-primary hover:underline"
					href="{base}/sites/{hold.site_id}?tab=visits"
					onclick={(e) => e.stopPropagation()}>Open the site's visits</a
				>
			{/if}
		</td>
	{/snippet}
	{#snippet detail(hold)}
		<p class="text-sm">{KIND_TIP[hold.kind]}</p>
		<p class="text-xs text-brand-muted mt-2">
			{hold.site_name ?? 'Unknown site'}, {formatDateTime(hold.group_time)}{#if hold.kind === 'unverified_entry'}, {hold.parameter_name ?? hold.parameter_code}{/if}. Entered by {enteredBy(hold)}.
		</p>
	{/snippet}
	{#snippet detailActions(hold, ctx)}
		{#if hold.kind === 'unverified_entry'}
			<input
				type="text"
				bind:value={reason}
				placeholder="Reason (used when rejecting)"
				aria-label="Reason for rejecting"
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
			/>
			<ConfirmPopover
				message="Verify this entry? The value is served as it stands and the decision is recorded against it."
				confirmLabel="Verify"
				confirmVariant="primary"
				above
				onconfirm={() => rule(hold, 'verify', ctx)}
			>
				<Button variant="primary" disabled={ruling}>{ruling ? 'Saving…' : 'Verify'}</Button>
			</ConfirmPopover>
			<ConfirmPopover
				message="Reject this entry? The value is withdrawn, stays on the record with the reason, and is not served."
				confirmLabel="Reject"
				confirmVariant="alarm"
				above
				onconfirm={() => rule(hold, 'reject', ctx)}
			>
				<Button disabled={ruling}>Reject</Button>
			</ConfirmPopover>
		{:else}
			<ConfirmPopover
				message="Verify the field day at {hold.site_name ?? 'this site'} on {formatDateTime(hold.group_time)}? It says the visit happened. Each measurement entered there is still verified on its own."
				confirmLabel="Verify"
				confirmVariant="primary"
				above
				onconfirm={() => rule(hold, 'verify', ctx)}
			>
				<Button variant="primary" disabled={ruling}>Verify the field day</Button>
			</ConfirmPopover>
			<ConfirmPopover
				message="Reject this field day? It is withdrawn with every reading entered there. Nothing is deleted: a reassert restores the readings."
				confirmLabel="Reject"
				confirmVariant="alarm"
				above
				onconfirm={() => rule(hold, 'reject', ctx)}
			>
				<Button variant="danger" disabled={ruling}>Reject the field day</Button>
			</ConfirmPopover>
		{/if}
	{/snippet}
</EventPanel>
