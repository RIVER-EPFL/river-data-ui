<script lang="ts">
	import { base } from '$app/paths';
	import {
		getCurationDrift,
		listUndeclaredSdEstimators,
		type CurationDriftResponse,
		type UndeclaredEstimatorsResponse
	} from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { formatDateTime } from '$lib/utils';

	// Two read-only reports of what is inconsistent right now. Both are computed on request, so
	// the time shown is when this page asked, and neither of them changes anything.

	let drift = $state<CurationDriftResponse | null>(null);
	let estimators = $state<UndeclaredEstimatorsResponse | null>(null);
	let checkedAt = $state<string | null>(null);
	let loading = $state(true);
	let error = $state('');
	let open = $state<'drift' | 'estimators' | null>(null);

	async function load() {
		loading = true;
		error = '';
		try {
			[drift, estimators] = await Promise.all([getCurationDrift(50), listUndeclaredSdEstimators()]);
			checkedAt = new Date().toISOString();
		} catch (e) {
			error = e instanceof Error ? e.message : 'The reports could not be read';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load();
	});

	function toggle(which: 'drift' | 'estimators') {
		open = open === which ? null : which;
	}
</script>

<div class="overflow-hidden rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex flex-wrap items-center gap-3 border-b border-brand-divider px-4 py-3">
		<span class="font-semibold">Invariant reports</span>
		<span class="text-xs text-brand-muted">
			What is inconsistent right now. Both are read-only: what to do about a row is a decision, so
			nothing here changes a stored value.
		</span>
		<div class="flex-1"></div>
		<span class="text-xs text-brand-muted">
			{checkedAt ? `Checked ${formatDateTime(checkedAt)}` : 'Not checked yet'}
		</span>
		<Button size="sm" disabled={loading} onclick={() => load()}>
			{loading ? 'Checking…' : 'Check again'}
		</Button>
	</div>

	{#if error}
		<div class="px-4 py-3"><ErrorNotice message={error} /></div>
	{:else if loading && !drift}
		<p class="px-4 py-3 text-brand-muted">Loading…</p>
	{:else}
		<div class="divide-y divide-brand-divider">
			<div>
				<button
					class="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
					onclick={() => toggle('drift')}
				>
					<span class="w-3 text-xs text-brand-muted">{open === 'drift' ? '▾' : '▸'}</span>
					<span
						class="h-2.5 w-2.5 rounded-full {drift?.total
							? 'bg-severity-warning-fill'
							: 'bg-severity-ok-fill'}"
					></span>
					<span class="text-sm font-semibold">Readings that disagree with their decision record</span>
					<span class="ml-auto text-xs text-brand-muted">
						{drift?.total ? `${drift.total} reading${drift.total === 1 ? '' : 's'}` : 'None'}
					</span>
				</button>
				{#if open === 'drift'}
					<div class="px-4 pb-4">
						{#if !drift?.total}
							<p class="text-xs text-brand-muted">
								Every reading's curation columns are the fold of the decisions recorded against it.
							</p>
						{:else}
							<table class="w-full text-sm">
								<thead class="text-xs text-brand-muted">
									<tr>
										<th class="py-1 text-left">Reading</th>
										<th class="py-1 text-left">Time</th>
										<th class="py-1 text-left">The row holds</th>
										<th class="py-1 text-left">Its decisions say</th>
									</tr>
								</thead>
								<tbody>
									{#each drift.rows as row (`${row.stream_id}-${row.time}-${row.replicate_index}`)}
										<tr class="border-t border-brand-divider">
											<td class="py-1">
												{#if row.site_id && row.parameter_id}
													<a
														class="text-brand-primary hover:underline"
														href="{base}/sites/{row.site_id}?focus={row.parameter_id}">Open the point</a
													>
												{:else}
													<span class="text-brand-muted">unpaired</span>
												{/if}
											</td>
											<td class="py-1 text-xs"
												>{formatDateTime(row.time)}<span class="text-brand-muted">
													· rep {row.replicate_index}</span
												></td
											>
											<td class="py-1 font-mono text-xs">{JSON.stringify(row.stored)}</td>
											<td class="py-1 font-mono text-xs">{JSON.stringify(row.folded)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
							{#if drift.total > drift.rows.length}
								<p class="pt-2 text-xs text-brand-muted">
									Showing {drift.rows.length} of {drift.total}.
								</p>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			<div>
				<button
					class="flex w-full cursor-pointer items-center gap-3 border-none bg-transparent px-4 py-3 text-left"
					onclick={() => toggle('estimators')}
				>
					<span class="w-3 text-xs text-brand-muted">{open === 'estimators' ? '▾' : '▸'}</span>
					<span
						class="h-2.5 w-2.5 rounded-full {estimators?.total_slots
							? 'bg-severity-warning-fill'
							: 'bg-severity-ok-fill'}"
					></span>
					<span class="text-sm font-semibold">Slots serving statistics under no declared sd estimator</span>
					<span class="ml-auto text-xs text-brand-muted">
						{estimators?.total_slots
							? `${estimators.total_slots} slot${estimators.total_slots === 1 ? '' : 's'}`
							: 'None'}
					</span>
				</button>
				{#if open === 'estimators'}
					<div class="px-4 pb-4">
						{#if !estimators?.total_slots}
							<p class="text-xs text-brand-muted">
								Every slot serving replicate statistics has declared which divisor it publishes.
							</p>
						{:else}
							<table class="w-full text-sm">
								<thead class="text-xs text-brand-muted">
									<tr>
										<th class="py-1 text-left">Slot</th>
										<th class="py-1 text-right">Samples under the fallback</th>
										<th class="py-1 text-right">Open holds</th>
										<th class="py-1 text-right">Holds the population divisor explains</th>
									</tr>
								</thead>
								<tbody>
									{#each estimators.slots as slot (slot.site_parameter_id)}
										<tr class="border-t border-brand-divider">
											<td class="py-1">
												<a
													class="text-brand-primary hover:underline"
													href="{base}/sites/{slot.site_id}?focus={slot.parameter_id}"
													>{slot.site_name} · {slot.parameter_code}</a
												>
											</td>
											<td class="py-1 text-right tabular-nums">{slot.undeclared_samples}</td>
											<td class="py-1 text-right tabular-nums">{slot.open_holds}</td>
											<td class="py-1 text-right tabular-nums"
												>{slot.population_signature_holds}</td
											>
										</tr>
									{/each}
								</tbody>
							</table>
							<p class="pt-2 text-xs text-brand-muted">
								A hold carrying the population signature cannot be acknowledged until its slot
								declares an estimator, which is done from the slot.
							</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
