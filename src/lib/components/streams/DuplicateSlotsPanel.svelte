<script lang="ts">
	import { base } from '$app/paths';
	import { getDuplicateSlots, type DuplicateSlot } from '$api/service';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { formatCount } from '$lib/format';

	// Serving returns one row per (site, parameter, instant), so a slot two streams feed is drawn
	// exactly like a slot one stream feeds. This is where the operator sees which slots still hold
	// two feeds of the same measurement.

	let slots = $state<DuplicateSlot[]>([]);
	let loading = $state(true);
	let error = $state('');

	$effect(() => {
		getDuplicateSlots()
			.then((r) => (slots = r.slots))
			.catch((e) => (error = e instanceof Error ? e.message : 'Failed to load duplicated slots'))
			.finally(() => (loading = false));
	});
</script>

<div class="overflow-hidden rounded-md border border-brand-divider bg-brand-surface">
	<div class="flex flex-wrap items-center gap-3 border-b border-brand-divider px-4 py-3">
		<span class="font-semibold">Duplicated slots</span>
		<span class="text-xs text-brand-muted">
			Slots where two streams carry the same instant. The chart draws one point, so these are only
			visible here.
		</span>
	</div>

	{#if loading}
		<p class="px-4 py-3 text-sm text-brand-muted">Loading duplicated slots…</p>
	{:else if error}
		<div class="px-4 py-3"><ErrorNotice message={error} /></div>
	{:else if slots.length === 0}
		<p class="px-4 py-3 text-sm text-severity-ok">No slot is fed by more than one stream.</p>
	{:else}
		<table class="w-full text-sm">
			<thead
				><tr class="border-b border-brand-divider bg-brand-bg">
					<th class="px-4 py-2 text-left font-semibold">Site</th>
					<th class="px-4 py-2 text-left font-semibold">Parameter</th>
					<th
						class="px-4 py-2 text-right font-semibold"
						title="Instants carrying readings from more than one stream">Shared instants</th
					>
					<th class="px-4 py-2 text-left font-semibold">Feeds</th>
				</tr></thead
			>
			<tbody>
				{#each slots as s (s.site_parameter_id)}
					<tr class="border-b border-brand-divider last:border-b-0">
						<td class="px-4 py-2">
							<a
								class="text-brand-primary hover:underline"
								href="{base}/sites/{s.site_id}?focus={s.parameter_id}">{s.site_name}</a
							>
						</td>
						<td class="px-4 py-2">{s.parameter_name}</td>
						<td class="px-4 py-2 text-right font-mono text-xs tabular-nums"
							>{formatCount(s.duplicated_instants)}</td
						>
						<td class="px-4 py-2">
							<ul class="flex flex-col gap-0.5">
								{#each s.streams as st (st.stream_id)}
									<li class="font-mono text-xs">
										{st.source_key}
										<span class="text-brand-muted"
											>· {st.source_system} · {formatCount(st.readings)} readings</span
										>
									</li>
								{/each}
							</ul>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>
