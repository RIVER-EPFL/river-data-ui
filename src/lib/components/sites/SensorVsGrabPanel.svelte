<script lang="ts">
	// The portal's grab-versus-sensor comparison: each grab value against the average of the
	// continuous series over a window that starts a couple of hours after it, so the two are read
	// at the same water.
	import {
		downloadSensorVsGrabCsv,
		getSensorVsGrab,
		type SensorVsGrabQuery,
		type SensorVsGrabRow,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';

	let {
		siteId,
		parameters,
	}: {
		siteId: string;
		parameters: { id: string; label: string }[];
	} = $props();

	let parameterId = $state('');
	let windowStartHours = $state(2);
	let windowEndHours = $state(6);
	let rows = $state<SensorVsGrabRow[]>([]);
	let loading = $state(false);
	let loaded = $state(false);

	let downloading = $state(false);

	function query(): SensorVsGrabQuery | null {
		if (!parameterId) return null;
		if (windowEndHours <= windowStartHours) {
			toastStore.error('The window must end after it starts');
			return null;
		}
		return {
			parameter_id: parameterId,
			window_start_hours: windowStartHours,
			window_end_hours: windowEndHours,
		};
	}

	async function load() {
		const q = query();
		if (!q) return;
		loading = true;
		try {
			const res = await getSensorVsGrab(siteId, q);
			rows = res.rows;
			loaded = true;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load the comparison');
		} finally {
			loading = false;
		}
	}

	async function downloadCsv() {
		const q = query();
		if (!q) return;
		const label = parameters.find((p) => p.id === q.parameter_id)?.label ?? 'parameter';
		downloading = true;
		try {
			await downloadSensorVsGrabCsv(
				siteId,
				q,
				`${label.replace(/[^A-Za-z0-9]/g, '_')}_sensor_vs_grab.csv`,
			);
		} catch (e) {
			toastStore.error(e instanceof Error ? `Download failed: ${e.message}` : 'Download failed');
		} finally {
			downloading = false;
		}
	}

	function fmt(v: number | null): string {
		return v == null ? '-' : String(v);
	}
</script>

<div class="space-y-3">
	<p class="text-sm text-brand-muted">
		Each grab sample against the mean of the continuous series over [grab + {windowStartHours}h,
		grab + {windowEndHours}h], which is the comparison the portals shipped.
	</p>

	<div class="flex flex-wrap items-end gap-3">
		<div class="flex flex-col gap-1">
			<label for="svg-param" class="text-xs font-medium text-brand-muted">Parameter</label>
			<select
				id="svg-param"
				bind:value={parameterId}
				class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			>
				<option value=""> - Select a parameter - </option>
				{#each parameters as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
			</select>
		</div>
		<div class="flex flex-col gap-1">
			<label for="svg-from" class="text-xs font-medium text-brand-muted">Window from (h)</label>
			<input
				id="svg-from"
				type="number"
				step="0.5"
				bind:value={windowStartHours}
				class="w-24 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label for="svg-to" class="text-xs font-medium text-brand-muted">Window to (h)</label>
			<input
				id="svg-to"
				type="number"
				step="0.5"
				bind:value={windowEndHours}
				class="w-24 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
		<Button variant="primary" disabled={loading || !parameterId} onclick={load}>
			{loading ? 'Comparing…' : 'Compare'}
		</Button>
		{#if parameterId}
			<Button variant="secondary" disabled={downloading} onclick={downloadCsv}>
				Download CSV
			</Button>
		{/if}
	</div>

	{#if loaded && rows.length === 0}
		<p class="text-sm text-brand-muted">
			No grab samples for this parameter in the range, or none with continuous readings in the
			window.
		</p>
	{:else if rows.length > 0}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="bg-brand-bg text-brand-muted">
					<tr>
						<th class="text-left px-4 py-2 font-semibold">Grab time</th>
						<th class="text-right px-4 py-2 font-semibold">Grab</th>
						<th class="text-right px-4 py-2 font-semibold">Grab sd</th>
						<th class="text-right px-4 py-2 font-semibold">n</th>
						<th class="text-right px-4 py-2 font-semibold">Sensor mean</th>
						<th class="text-right px-4 py-2 font-semibold">Sensor sd</th>
						<th class="text-right px-4 py-2 font-semibold">n</th>
						<th class="text-right px-4 py-2 font-semibold">Difference</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.time)}
						<tr class="border-t border-brand-divider">
							<td class="px-4 py-2">{formatDateTime(r.time)}</td>
							<td class="px-4 py-2 text-right font-mono">{fmt(r.grab_value)}</td>
							<td class="px-4 py-2 text-right font-mono">{fmt(r.grab_sd)}</td>
							<td class="px-4 py-2 text-right font-mono">{r.grab_n}</td>
							<td class="px-4 py-2 text-right font-mono">{fmt(r.sensor_avg)}</td>
							<td class="px-4 py-2 text-right font-mono">{fmt(r.sensor_sd)}</td>
							<td class="px-4 py-2 text-right font-mono">{r.sensor_n}</td>
							<td class="px-4 py-2 text-right font-mono">{fmt(r.difference)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
