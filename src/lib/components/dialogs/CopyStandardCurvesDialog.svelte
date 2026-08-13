<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Sensor, type StandardCurve } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { apiMessage, curveEquation, curveLabel, uniqueCurveName } from '$lib/standardCurves';

	// A curve belongs to one instrument, so copying means writing new rows on the target with the
	// source's values: nothing is shared and the source is untouched. A plate series is normally
	// copied as a set, hence the multi-select. There is no bulk-create endpoint, so this is one POST
	// per curve and a partial result is reported rather than assumed away.
	let {
		open = $bindable(false),
		targetSensorId,
		targetSensorName,
		existingNames = [],
		onsuccess,
	}: {
		open: boolean;
		targetSensorId: string;
		targetSensorName: string;
		/** Curve names already on the target, so a copy does not land on an ambiguous duplicate. */
		existingNames?: string[];
		onsuccess?: () => void;
	} = $props();

	let sensors = $state<Sensor[]>([]);
	let sourceId = $state('');
	let sourceCurves = $state<StandardCurve[]>([]);
	let selected = $state<Set<string>>(new Set());
	let loadingCurves = $state(false);
	let working = $state(false);
	let error = $state('');

	const sourceSensor = $derived(sensors.find((s) => s.id === sourceId) ?? null);

	function sensorDisplay(s: Sensor): string {
		const label = s.name ?? s.serial_number ?? s.id;
		return `${label} (${s.is_lab_instrument ? 'Lab' : 'Field'})`;
	}

	onMount(async () => {
		try {
			const res = await api.sensors.list({ perPage: 1000, filter: { is_active: true }, sort: ['name', 'ASC'] });
			sensors = res.data.filter((s) => s.id !== targetSensorId);
		} catch (e) {
			error = apiMessage(e);
		}
	});

	async function loadSourceCurves() {
		selected = new Set();
		sourceCurves = [];
		error = '';
		if (!sourceId) return;
		loadingCurves = true;
		try {
			const res = await api.standardCurves.list({
				perPage: 200,
				filter: { sensor_id: sourceId },
				sort: ['created_at', 'DESC'],
			});
			sourceCurves = res.data;
		} catch (e) {
			error = apiMessage(e);
		} finally {
			loadingCurves = false;
		}
	}

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	async function copySelected() {
		const chosen = sourceCurves.filter((c) => selected.has(c.id));
		if (chosen.length === 0) return;
		working = true;
		error = '';
		const taken = new Set(existingNames);
		const provenance = sourceSensor ? sensorDisplay(sourceSensor) : sourceId;
		let copied = 0;
		let firstFailure = '';
		for (const curve of chosen) {
			const base = curveLabel(curve);
			const name = taken.has(base) ? uniqueCurveName(base, taken) : base;
			try {
				await api.standardCurves.create({
					sensor_id: targetSensorId,
					name,
					slope: curve.slope,
					intercept: curve.intercept,
					r_squared: curve.r_squared,
					// There is no lineage column, so provenance is recorded as text.
					notes: `Copied from ${provenance} curve ${curve.id}${curve.notes ? ` · ${curve.notes}` : ''}`,
					created_by: me.data?.email ?? null,
				});
				taken.add(name);
				copied += 1;
			} catch (e) {
				if (!firstFailure) firstFailure = apiMessage(e);
			}
		}
		working = false;

		if (copied > 0) {
			toastStore.success(`Copied ${copied} of ${chosen.length} curve${chosen.length === 1 ? '' : 's'} to ${targetSensorName}`);
			onsuccess?.();
		}
		if (copied === chosen.length) {
			open = false;
			sourceId = '';
			sourceCurves = [];
			selected = new Set();
		} else {
			error = `Copied ${copied} of ${chosen.length}. ${firstFailure}`;
		}
	}
</script>

<Dialog bind:open title={`Copy standard curves to ${targetSensorName}`} maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<p class="text-sm text-brand-muted">
				The values are duplicated onto this instrument; the source keeps its own curves and later
				edits on either side stay separate.
			</p>

			<div class="flex flex-col gap-1">
				<label for="copy-curve-source" class="text-sm font-medium">Copy from</label>
				<select
					id="copy-curve-source"
					bind:value={sourceId}
					onchange={loadSourceCurves}
					class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value="">Select an instrument…</option>
					{#each sensors as s (s.id)}
						<option value={s.id}>{sensorDisplay(s)}</option>
					{/each}
				</select>
			</div>

			{#if sourceId}
				{#if loadingCurves}
					<p class="text-sm text-brand-muted">Loading…</p>
				{:else if sourceCurves.length === 0}
					<p class="text-sm text-brand-muted">That instrument has no curves to copy.</p>
				{:else}
					<div class="max-h-64 overflow-y-auto rounded-md border border-brand-divider divide-y divide-brand-divider">
						{#each sourceCurves as curve (curve.id)}
							<label class="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-brand-bg">
								<input type="checkbox" checked={selected.has(curve.id)} onchange={() => toggle(curve.id)} class="mt-1" />
								<span class="flex flex-col min-w-0">
									<span class="text-sm font-semibold truncate">{curveLabel(curve)}</span>
									<span class="text-xs text-brand-muted font-mono">
										{curveEquation(curve)}{curve.r_squared == null ? '' : ` · R² ${curve.r_squared}`}
									</span>
								</span>
							</label>
						{/each}
					</div>
				{/if}
			{/if}

			{#if error}
				<ErrorNotice message={error} />
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" onclick={copySelected} disabled={working || selected.size === 0}>
			{working ? 'Copying…' : selected.size > 1 ? `Copy ${selected.size} curves` : 'Copy curve'}
		</Button>
	{/snippet}
</Dialog>
