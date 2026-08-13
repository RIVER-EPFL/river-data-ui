<script lang="ts" module>
	export interface CurveSelection {
		// Set when the slope/intercept came from a stored sensor_calibrations row.
		calibrationId: string | null;
		slope: number | null;
		intercept: number | null;
		// Provenance shown at the save step.
		label: string | null;
	}

	export function emptyCurveSelection(): CurveSelection {
		return { calibrationId: null, slope: null, intercept: null, label: null };
	}
</script>

<script lang="ts">
	import { api, type Sensor, type SensorCalibration } from '$api/crud';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDate } from '$lib/utils';

	// Stored-curve dropdown (instrument -> its sensor_calibrations) with a
	// manual slope/intercept fallback. Writes the resolved selection to `value`.
	let {
		title,
		required = false,
		value = $bindable(emptyCurveSelection()),
		previewValue = null,
	}: {
		title: string;
		required?: boolean;
		value: CurveSelection;
		previewValue?: number | null;
	} = $props();

	type Mode = 'stored' | 'manual';
	let mode = $state<Mode>('stored');

	let instruments = $state<Sensor[]>([]);
	let selectedInstrumentId = $state('');
	let curves = $state<SensorCalibration[]>([]);
	let loadingCurves = $state(false);
	let selectedCurveId = $state('');

	let manualSlope = $state('');
	let manualIntercept = $state('');

	const selectedCurve = $derived(curves.find((c) => c.id === selectedCurveId) ?? null);

	const corrected = $derived.by(() => {
		if (previewValue === null || value.slope === null || value.intercept === null) return null;
		return value.slope * previewValue + value.intercept;
	});

	function instrumentLabel(instrument: Sensor): string {
		const name = instrument.name ?? instrument.serial_number ?? instrument.id;
		return `${name} (${instrument.is_lab_instrument ? 'Lab' : 'Field'})`;
	}

	function curveLabel(c: SensorCalibration): string {
		const name = c.name ?? 'unnamed';
		return `${name} (${formatDate(c.valid_from)}): y = ${c.slope}x + ${c.intercept}`;
	}

	function publish() {
		if (mode === 'stored' && selectedCurve) {
			value = {
				calibrationId: selectedCurve.id,
				slope: selectedCurve.slope,
				intercept: selectedCurve.intercept,
				label: `${selectedCurve.name ?? 'unnamed'} (${formatDate(selectedCurve.valid_from)})`,
			};
		} else if (mode === 'manual') {
			const s = Number(manualSlope);
			const i = Number(manualIntercept);
			const ok =
				manualSlope !== '' && manualIntercept !== '' && Number.isFinite(s) && Number.isFinite(i);
			value = ok
				? { calibrationId: null, slope: s, intercept: i, label: `manual y = ${s}x + ${i}` }
				: emptyCurveSelection();
		} else {
			value = emptyCurveSelection();
		}
	}

	function setMode(m: Mode) {
		mode = m;
		publish();
	}

	async function loadInstruments() {
		if (instruments.length > 0) return;
		try {
			const res = await api.sensors.list({
				perPage: 1000,
				filter: { is_active: true },
				sort: ['name', 'ASC'],
			});
			instruments = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load instruments');
		}
	}

	async function loadCurves(sensorId: string) {
		selectedCurveId = '';
		curves = [];
		publish();
		if (!sensorId) return;
		loadingCurves = true;
		try {
			const res = await api.sensorCalibrations.list({
				perPage: 200,
				filter: { sensor_id: sensorId },
				sort: ['valid_from', 'DESC'],
			});
			curves = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load curves');
		} finally {
			loadingCurves = false;
		}
	}

	$effect(() => {
		void loadInstruments();
	});
</script>

<div class="flex flex-col gap-1.5 border border-brand-divider rounded-md p-2.5">
	<div class="flex items-center justify-between">
		<span class="text-sm font-medium">
			{title}
			{#if required}<span class="text-severity-alarm">*</span>{:else}<span class="text-brand-muted font-normal"> (optional)</span>{/if}
		</span>
		<div class="flex gap-1">
			{#each ['stored', 'manual'] as m}
				<button
					type="button"
					onclick={() => setMode(m as Mode)}
					class="px-2 py-0.5 text-xs rounded-md border {mode === m
						? 'bg-brand-primary text-white border-brand-primary'
						: 'bg-brand-surface text-brand-muted border-brand-divider'}"
				>{m === 'stored' ? 'Stored curve' : 'Manual'}</button>
			{/each}
		</div>
	</div>

	{#if mode === 'stored'}
		<select
			bind:value={selectedInstrumentId}
			onchange={() => loadCurves(selectedInstrumentId)}
			aria-label="{title} instrument"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		>
			<option value=""> - Select instrument - </option>
			{#each instruments as i}
				<option value={i.id}>{instrumentLabel(i)}</option>
			{/each}
		</select>
		{#if selectedInstrumentId}
			{#if loadingCurves}
				<p class="text-xs text-brand-muted">Loading…</p>
			{:else if curves.length === 0}
				<p class="text-xs text-brand-muted">No curves on this instrument</p>
			{:else}
				<select
					bind:value={selectedCurveId}
					onchange={publish}
					aria-label="{title} curve"
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value=""> - Select curve - </option>
					{#each curves as c}
						<option value={c.id}>{curveLabel(c)}</option>
					{/each}
				</select>
			{/if}
		{/if}
	{:else}
		<div class="grid grid-cols-2 gap-2">
			<input
				type="number"
				step="any"
				bind:value={manualSlope}
				oninput={publish}
				placeholder="slope"
				aria-label="{title} slope"
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
			<input
				type="number"
				step="any"
				bind:value={manualIntercept}
				oninput={publish}
				placeholder="intercept"
				aria-label="{title} intercept"
				class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm"
			/>
		</div>
	{/if}

	{#if value.slope !== null && value.intercept !== null}
		<p class="text-xs text-brand-muted">
			y = {value.slope}x + {value.intercept}
			{#if corrected !== null && previewValue !== null}
				&middot; {previewValue} &rarr; <span class="font-medium text-brand-text">{corrected.toPrecision(6)}</span>
			{/if}
		</p>
	{:else if !required}
		<p class="text-xs text-brand-muted">No correction applied</p>
	{/if}
</div>
