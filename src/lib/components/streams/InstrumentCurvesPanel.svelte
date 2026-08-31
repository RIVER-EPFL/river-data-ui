<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import {
		getInstrumentsOverview,
		getCurveUsage,
		type InstrumentOverview,
		type CurveOverview,
		type CurveUsageResponse,
	} from '$api/service';
	import { formatEquation } from '$lib/standardCurves';
	import { formatDateTime, formatDate } from '$lib/utils';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let instruments = $state<InstrumentOverview[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let expanded = $state<Set<string>>(new Set());
	// Per-curve drill-down: the corrected readings, fetched once when first opened.
	let openCurveId = $state<string | null>(null);
	let usage = $state<Record<string, CurveUsageResponse>>({});
	let usageLoading = $state(false);

	onMount(load);

	async function load() {
		loading = true;
		error = null;
		try {
			instruments = (await getInstrumentsOverview()).instruments;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load instruments';
		} finally {
			loading = false;
		}
	}

	function toggle(id: string) {
		const next = new Set(expanded);
		if (!next.delete(id)) next.add(id);
		expanded = next;
	}

	async function toggleCurve(curve: CurveOverview) {
		if (openCurveId === curve.id) {
			openCurveId = null;
			return;
		}
		openCurveId = curve.id;
		if (!usage[curve.id] && curve.reading_count > 0) {
			usageLoading = true;
			try {
				usage = { ...usage, [curve.id]: await getCurveUsage(curve.id) };
			} catch {
				// The drill-down stays empty; the row still shows its counts.
			} finally {
				usageLoading = false;
			}
		}
	}

	function instrumentTitle(i: InstrumentOverview): string {
		return i.name || i.serial_number || i.source_key || i.id.slice(0, 8);
	}

	const totalCurves = $derived(instruments.reduce((s, i) => s + i.curves.length, 0));
</script>

{#if loading}
	<p class="text-brand-muted">Loading…</p>
{:else if error}
	<ErrorNotice message={error} />
{:else if instruments.length === 0}
	<p class="text-sm text-brand-muted">
		No instruments yet. Instruments appear here when a sync registers standard curves or a
		stream names a device.
	</p>
{:else}
	<p class="text-xs text-brand-muted">{instruments.length} instruments, {totalCurves} standard curves</p>
	<div class="space-y-2">
		{#each instruments as inst (inst.id)}
			{@const open = expanded.has(inst.id)}
			<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
				<button
					onclick={() => toggle(inst.id)}
					class="w-full flex items-center gap-2 px-4 py-3 cursor-pointer bg-transparent border-none text-left"
				>
					<span class="text-brand-muted text-xs w-3">{open ? '▾' : '▸'}</span>
					<span class="font-semibold text-sm">{instrumentTitle(inst)}</span>
					{#if inst.is_lab_instrument}
						<Badge variant="accent">lab</Badge>
					{/if}
					{#if inst.source_system}
						<span class="text-xs text-brand-muted">{inst.source_system}</span>
					{/if}
					<span class="text-xs text-brand-muted ml-auto">
						{inst.curves.length} curve{inst.curves.length === 1 ? '' : 's'}, {inst.streams.length} stream{inst.streams.length === 1 ? '' : 's'}
					</span>
				</button>

				{#if open}
					<div class="px-4 pb-4 space-y-4 border-t border-brand-divider pt-3">
						<div class="text-xs text-brand-muted flex flex-wrap gap-x-4 gap-y-1">
							{#if inst.manufacturer}<span>Manufacturer: {inst.manufacturer}</span>{/if}
							{#if inst.model}<span>Model: {inst.model}</span>{/if}
							{#if inst.serial_number}<span>Serial: {inst.serial_number}</span>{/if}
							{#if inst.source_key}<span>Source: {inst.source_key}</span>{/if}
							<a href="{base}/sensors/{inst.id}?tab=curves" class="text-brand-primary">Open in inventory</a>
						</div>

						{#if inst.curves.length > 0}
							<div>
								<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted mb-1">Standard curves</h4>
								<div class="rounded-md border border-brand-divider overflow-x-auto">
									<table class="w-full text-sm">
										<thead>
											<tr class="bg-brand-bg border-b border-brand-divider text-xs">
												<th class="text-left px-3 py-1.5 font-semibold">Curve</th>
												<th class="text-left px-3 py-1.5 font-semibold">Equation</th>
												<th class="text-right px-3 py-1.5 font-semibold">R²</th>
												<th class="text-left px-3 py-1.5 font-semibold">Source</th>
												<th class="text-right px-3 py-1.5 font-semibold">Readings corrected</th>
												<th class="text-left px-3 py-1.5 font-semibold">Used</th>
											</tr>
										</thead>
										<tbody>
											{#each inst.curves as curve (curve.id)}
												<tr
													class="border-b border-brand-divider last:border-b-0 {curve.reading_count > 0 ? 'cursor-pointer hover:bg-brand-bg' : ''}"
													onclick={() => toggleCurve(curve)}
												>
													<td class="px-3 py-1.5">{curve.name ?? curve.id.slice(0, 8)}</td>
													<td class="px-3 py-1.5 font-mono text-xs">{formatEquation(curve.slope, curve.intercept)}</td>
													<td class="px-3 py-1.5 text-right font-mono text-xs">{curve.r_squared ?? '—'}</td>
													<td class="px-3 py-1.5 text-xs text-brand-muted">{curve.source_key ?? 'manual'}</td>
													<td class="px-3 py-1.5 text-right">{curve.reading_count}</td>
													<td class="px-3 py-1.5 text-xs text-brand-muted">
														{curve.first_used ? `${formatDate(curve.first_used)} – ${formatDate(curve.last_used ?? curve.first_used)}` : 'Never'}
													</td>
												</tr>
												{#if openCurveId === curve.id}
													<tr class="border-b border-brand-divider last:border-b-0">
														<td colspan="6" class="px-3 py-2 bg-brand-bg">
															{#if usageLoading && !usage[curve.id]}
																<p class="text-xs text-brand-muted">Loading readings…</p>
															{:else if usage[curve.id]}
																{@const u = usage[curve.id]}
																<p class="text-xs text-brand-muted mb-1">
																	{u.reading_count} readings corrected{u.reading_count > u.points.length ? `, most recent ${u.points.length} shown` : ''}
																</p>
																<div class="max-h-56 overflow-y-auto">
																	<table class="w-full text-xs">
																		<thead>
																			<tr class="text-brand-muted">
																				<th class="text-left py-0.5 font-medium">Time</th>
																				<th class="text-left py-0.5 font-medium">Site</th>
																				<th class="text-left py-0.5 font-medium">Parameter</th>
																				<th class="text-right py-0.5 font-medium">Rep</th>
																				<th class="text-right py-0.5 font-medium">Raw</th>
																				<th class="text-right py-0.5 font-medium">Corrected</th>
																			</tr>
																		</thead>
																		<tbody>
																			{#each u.points as p (p.time + ':' + p.replicate_index)}
																				<tr class={p.is_flagged ? 'text-severity-warning-text' : ''}>
																					<td class="py-0.5">{formatDateTime(p.time)}</td>
																					<td class="py-0.5">{p.site_name ?? '—'}</td>
																					<td class="py-0.5">{p.parameter_code ?? '—'}</td>
																					<td class="py-0.5 text-right font-mono">{p.replicate_index}</td>
																					<td class="py-0.5 text-right font-mono">{p.raw_value}</td>
																					<td class="py-0.5 text-right font-mono">{p.calibrated_value ?? '—'}</td>
																				</tr>
																			{/each}
																		</tbody>
																	</table>
																</div>
															{:else}
																<p class="text-xs text-brand-muted">No readings loaded.</p>
															{/if}
														</td>
													</tr>
												{/if}
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}

						{#if inst.streams.length > 0}
							<div>
								<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted mb-1">Streams feeding this instrument</h4>
								<ul class="text-xs space-y-0.5">
									{#each inst.streams as stream (stream.id)}
										<li class="flex items-center gap-2">
											<span class="font-mono">{stream.source_system}:{stream.source_key}</span>
											{#if stream.site_name}
												<span class="text-brand-muted">→ {stream.site_name} / {stream.parameter_code}</span>
											{:else}
												<Badge variant="muted">unpaired</Badge>
											{/if}
											{#if stream.measurement_type}
												<span class="text-brand-muted">{stream.measurement_type}</span>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
