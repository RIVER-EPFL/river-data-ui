<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$api/crud';
	import { acknowledgeReplicateAudit, listReplicateAudits, type ReplicateAuditHold } from '$api/service';
	import { identityChanges } from '$lib/holds';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	// A feed of this instrument reporting a device identity other than the stored one. The swap is
	// recorded with this page's own actions; acknowledging says the attribution stands.
	let { sensorId, canAcknowledge }: { sensorId: string; canAcknowledge: boolean } = $props();

	let holds = $state<ReplicateAuditHold[]>([]);
	let acknowledging = $state(false);

	async function load() {
		try {
			const streams = await api.dataStreams.list({ perPage: 200, filter: { sensor_id: sensorId } });
			if (streams.data.length === 0) {
				holds = [];
				return;
			}
			holds = (
				await listReplicateAudits({
					stream_ids: streams.data.map((s) => s.id).join(','),
					kind: 'source_identity_changed',
					status: 'pending',
				})
			).holds;
		} catch {
			holds = [];
		}
	}

	onMount(load);

	async function acknowledge(hold: ReplicateAuditHold) {
		acknowledging = true;
		try {
			await acknowledgeReplicateAudit(hold.id);
			toastStore.success('Reviewed: the reported identity stands');
			await load();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			acknowledging = false;
		}
	}
</script>

{#each holds as hold (hold.id)}
	{@const changes = identityChanges(hold.expected, hold.computed)}
	<div
		class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-xs text-severity-warning-text space-y-1"
		role="status"
	>
		<p class="font-semibold">
			A feed reports a different device{hold.source_key ? `: ${hold.source_key}` : ''}, since {formatDateTime(hold.group_time)}
		</p>
		{#each changes as change (change.field)}
			<p>
				<span>{change.field.replace(/_/g, ' ')}:</span>
				<span class="font-mono">{change.was}</span>
				→
				<span class="font-mono">{change.now}</span>
			</p>
		{/each}
		<p>If the device really changed, record it with Deploy / Move or Add data; readings keep this instrument until then.</p>
		{#if canAcknowledge}
			<ConfirmPopover
				message="Mark this reviewed? The readings stay attributed as they are. Record the swap first if the device really changed: this only closes the finding."
				confirmLabel="Acknowledge"
				confirmVariant="primary"
				onconfirm={() => acknowledge(hold)}
			>
				<Button size="sm" disabled={acknowledging}>Acknowledge</Button>
			</ConfirmPopover>
		{/if}
	</div>
{/each}
