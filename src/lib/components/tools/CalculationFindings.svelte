<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import {
		acknowledgeReplicateAudit,
		listReplicateAudits,
		pollJob,
		recomputeCollectionEvent,
		stageCollectionEvent,
		type ReplicateAuditHold,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import { CALCULATION_FINDING_KINDS, KIND_LABEL, KIND_STYLE, KIND_TIP } from '$lib/holds';
	import { apiMessage } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';

	// The chain's and the event audit's findings against one calculation, each worked at its visit.
	let { calculation, onchange }: { calculation: string; onchange?: () => void } = $props();

	const PAGE_SIZE = 50;
	let findings = $state<ReplicateAuditHold[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let busy = $state<string | null>(null);

	async function load() {
		loading = true;
		try {
			const r = await listReplicateAudits({
				status: 'pending',
				kind: CALCULATION_FINDING_KINDS.join(','),
				tool: calculation,
				page_size: PAGE_SIZE,
			});
			findings = r.holds;
			total = r.total;
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// The visit standing at (site, instant) is adopted and its chain runs as a tracked job; the
	// finding closes when the run rewrites the output.
	async function recompute(hold: ReplicateAuditHold) {
		if (!hold.site_id) return;
		busy = hold.id;
		try {
			const visit = await stageCollectionEvent({ site_id: hold.site_id, collected_at: hold.group_time });
			const r = await recomputeCollectionEvent(visit.id);
			if (r.job_id) {
				const job = await pollJob(r.job_id);
				if (job.status !== 'completed') {
					toastStore.error(job.error_message ?? 'The recompute did not complete');
					return;
				}
				const counts = (job.detail?.counts ?? {}) as Record<string, number>;
				const closed = counts.findings_closed ?? 0;
				toastStore.success(
					`Recomputed: ${counts.tools_run ?? 0} run, ${counts.tools_unchanged ?? 0} unchanged, ${closed} finding${closed === 1 ? '' : 's'} closed`,
				);
			}
			await load();
			onchange?.();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			busy = null;
		}
	}

	async function acknowledge(hold: ReplicateAuditHold) {
		busy = hold.id;
		try {
			await acknowledgeReplicateAudit(hold.id);
			toastStore.success('Finding acknowledged');
			await load();
			onchange?.();
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			busy = null;
		}
	}
</script>

<div class="text-xs">
	{#if loading}
		<p class="text-brand-muted">Loading findings…</p>
	{:else if findings.length === 0}
		<p class="text-brand-muted">No open findings against {calculation}.</p>
	{:else}
		<table class="w-full" aria-label="Findings against {calculation}">
			<thead class="text-left text-brand-muted">
				<tr>
					<th class="py-1 pr-3 font-medium">Finding</th>
					<th class="py-1 pr-3 font-medium">Site</th>
					<th class="py-1 pr-3 font-medium">Visit</th>
					<th class="py-1 pr-3 font-medium">Output</th>
					<th class="py-1 font-medium"><span class="sr-only">Actions</span></th>
				</tr>
			</thead>
			<tbody>
				{#each findings as hold (hold.id)}
					<tr class="border-t border-brand-divider">
						<td class="py-1 pr-3">
							<span class="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap {KIND_STYLE[hold.kind]}" title={KIND_TIP[hold.kind]}>
								{KIND_LABEL[hold.kind]}
							</span>
						</td>
						<td class="py-1 pr-3">{hold.site_name ?? '-'}</td>
						<td class="py-1 pr-3 whitespace-nowrap">{formatDateTime(hold.group_time)}</td>
						<td class="py-1 pr-3 font-mono">{hold.parameter_code ?? '-'}</td>
						<td class="py-1">
							<div class="flex items-center justify-end gap-1.5">
								{#if hold.site_id}
									<a
										class="text-brand-primary hover:underline whitespace-nowrap"
										href="{base}/sites/{hold.site_id}?tab=visits">Open the visit</a
									>
									<ConfirmPopover
										message="Recompute this visit? Every calculation whose inputs resolve there runs again and its outputs are rewritten; this finding closes if the run rewrites {hold.parameter_code ?? 'the output'}."
										confirmLabel="Recompute"
										confirmVariant="primary"
										above
										onconfirm={() => recompute(hold)}
									>
										<Button size="sm" variant="secondary" disabled={busy === hold.id}>
											{busy === hold.id ? 'Working…' : 'Recompute the visit'}
										</Button>
									</ConfirmPopover>
								{/if}
								<ConfirmPopover
									message="Mark this finding reviewed? The stored values stay as they are; recomputing the visit resolves it properly."
									confirmLabel="Acknowledge"
									confirmVariant="primary"
									above
									onconfirm={() => acknowledge(hold)}
								>
									<Button size="sm" variant="ghost" disabled={busy === hold.id}>Acknowledge</Button>
								</ConfirmPopover>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if total > findings.length}
			<p class="text-brand-muted mt-1">Showing {findings.length} of {total}.</p>
		{/if}
	{/if}
</div>
