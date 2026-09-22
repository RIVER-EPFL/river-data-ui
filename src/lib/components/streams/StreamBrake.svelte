<script lang="ts">
	import { onMount } from 'svelte';
	import { releaseStreamBrake, listReplicateAudits, type ReplicateAuditHold } from '$api/service';
	import { brakeSummary } from '$lib/holds';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	// A reconciliation pass that would reshape too much of this stream is held until a person
	// releases it; the release admits exactly one braked-scale pass on the next sync cycle.
	let { streamId, canRelease }: { streamId: string; canRelease: boolean } = $props();

	let holds = $state<ReplicateAuditHold[]>([]);
	let releasing = $state(false);

	async function load() {
		try {
			holds = (
				await listReplicateAudits({ stream_id: streamId, kind: 'brake_fired', status: 'pending' })
			).holds;
		} catch {
			holds = [];
		}
	}

	onMount(load);

	async function release(hold: ReplicateAuditHold) {
		releasing = true;
		try {
			await releaseStreamBrake(hold.id);
			toastStore.success('Brake released: the next pass may apply the reshape');
			await load();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			releasing = false;
		}
	}
</script>

{#each holds as hold (hold.id)}
	{@const window = (hold.expected as { window?: { from?: string; to?: string } } | null)?.window}
	<div
		class="rounded-md border border-severity-warning-border bg-severity-warning-soft px-3 py-2 text-xs text-severity-warning-text space-y-1"
		role="status"
	>
		<p class="font-semibold">The reconciliation brake is holding a pass</p>
		<p>
			{brakeSummary(hold.expected) ?? 'The pass would change more of this stream than the brake allows.'}
			{#if window?.from && window?.to}Window {formatDateTime(window.from)} to {formatDateTime(window.to)}.{/if}
			New rows applied; the changes and withdrawals did not.
		</p>
		{#if canRelease}
			<ConfirmPopover
				message="Release the brake? Exactly one braked-scale reconciliation pass is admitted on the next sync cycle; a later reshape brakes afresh."
				confirmLabel="Release"
				confirmVariant="primary"
				onconfirm={() => release(hold)}
			>
				<Button size="sm" variant="primary" disabled={releasing}>{releasing ? 'Releasing…' : 'Release the brake'}</Button>
			</ConfirmPopover>
		{/if}
	</div>
{/each}
