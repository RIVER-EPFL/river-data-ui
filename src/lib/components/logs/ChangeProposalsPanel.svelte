<script lang="ts">
	import { base } from '$app/paths';
	import {
		getChangeProposals,
		decideChangeProposals,
		type ChangeProposal
	} from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { formatDateTime } from '$lib/utils';

	// A stored value the source has changed since is proposed, never written, until somebody rules
	// on it. Accepting writes it as a correction that names them; rejecting records the refusal
	// against that exact number, so the source re-asserting it does not ask again.

	let { onPendingChange }: { onPendingChange?: (n: number) => void } = $props();

	let view = $state<'pending' | 'rejected' | 'accepted'>('pending');
	let rows = $state<ChangeProposal[]>([]);
	let selected = $state<Set<string>>(new Set());
	let loading = $state(true);
	let busy = $state(false);
	let error = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			rows = await getChangeProposals({ status: view });
			selected = new Set();
			if (view === 'pending') onPendingChange?.(rows.length);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load proposed corrections';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void view;
		load();
	});

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function decide(decision: 'accept' | 'reject') {
		if (selected.size === 0) return;
		busy = true;
		try {
			await decideChangeProposals([...selected], decision);
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'The decision was not recorded';
		} finally {
			busy = false;
		}
	}

	const views: Array<{ key: 'pending' | 'rejected' | 'accepted'; label: string }> = [
		{ key: 'pending', label: 'Awaiting a decision' },
		{ key: 'rejected', label: 'Rejected' },
		{ key: 'accepted', label: 'Accepted' }
	];
</script>

<div class="overflow-hidden rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex flex-wrap items-center gap-3 border-b border-brand-divider px-4 py-3">
		<span class="font-semibold">Values changed at source</span>
		<span class="text-xs text-brand-muted">
			New values are stored on sync as they always were. A value the source has changed since
			river-data stored it waits here: accepting writes it and records who accepted it, rejecting
			leaves the stored number and is not asked again while the source asserts the same value.
		</span>
		<div class="flex-1"></div>
		{#each views as v (v.key)}
			<button
				class="cursor-pointer border-none bg-transparent p-0 text-sm {view === v.key
					? 'font-semibold text-brand-text'
					: 'text-brand-muted hover:underline'}"
				onclick={() => (view = v.key)}>{v.label}</button
			>
		{/each}
	</div>

	{#if view === 'pending' && rows.length > 0}
		<div class="flex items-center gap-3 border-b border-brand-divider px-4 py-2 text-sm">
			<span class="text-brand-muted">{selected.size} selected</span>
			<Button disabled={busy || selected.size === 0} onclick={() => decide('accept')}
				>Accept</Button
			>
			<Button disabled={busy || selected.size === 0} onclick={() => decide('reject')}
				>Reject</Button
			>
		</div>
	{/if}

	{#if loading}
		<p class="px-4 py-3 text-sm text-brand-muted">Loading proposed corrections…</p>
	{:else if error}
		<div class="px-4 py-3"><ErrorNotice message={error} /></div>
	{:else if rows.length === 0}
		<p class="px-4 py-3 text-sm text-severity-ok">
			{view === 'pending'
				? 'No source correction is waiting for a decision.'
				: `No ${view} correction.`}
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="border-b border-brand-divider bg-brand-bg">
						{#if view === 'pending'}<th class="w-8 px-4 py-2"></th>{/if}
						<th class="px-4 py-2 text-left font-semibold">Slot</th>
						<th class="px-4 py-2 text-left font-semibold">Instant</th>
						<th class="px-4 py-2 text-right font-semibold">Stored</th>
						<th class="px-4 py-2 text-right font-semibold">At source</th>
						<th class="px-4 py-2 text-left font-semibold">Source</th>
						<th class="px-4 py-2 text-left font-semibold">Decided</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as p (p.id)}
						<tr class="border-b border-brand-divider last:border-b-0">
							{#if view === 'pending'}
								<td class="px-4 py-2">
									<input
										type="checkbox"
										checked={selected.has(p.id)}
										onchange={() => toggle(p.id)}
									/>
								</td>
							{/if}
							<td class="px-4 py-2">
								{#if p.site_id}
									<a
										class="text-brand-primary hover:underline"
										href="{base}/sites/{p.site_id}?focus={p.parameter_id}"
										>{p.site_name} · {p.parameter_code}</a
									>
								{:else}
									<span class="text-brand-muted">unpaired</span>
								{/if}
							</td>
							<td class="px-4 py-2 text-xs"
								>{formatDateTime(p.time)}<span class="text-brand-muted"
									> · rep {p.replicate_index}</span
								></td
							>
							<td class="px-4 py-2 text-right font-mono text-xs tabular-nums"
								>{p.stored_raw_value}</td
							>
							<td class="px-4 py-2 text-right font-mono text-xs tabular-nums"
								>{p.proposed_raw_value}</td
							>
							<td class="px-4 py-2 font-mono text-xs">{p.source_system}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">
								{p.decided_by ? `${p.decided_by} · ${formatDateTime(p.decided_at ?? '')}` : '—'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
