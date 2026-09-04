<script lang="ts" module>
	export interface CurveSelection {
		// Set when the slope/intercept came from a stored standard_curves row.
		standardCurveId: string | null;
		slope: number | null;
		intercept: number | null;
		// Provenance shown at the save step.
		label: string | null;
	}

	export function emptyCurveSelection(): CurveSelection {
		return { standardCurveId: null, slope: null, intercept: null, label: null };
	}
</script>

<script lang="ts">
	import { api, type Sensor, type StandardCurve } from '$api/crud';
	import { getLastUsedCurve, type LastUsedCurve } from '$api/service';
	import LastUsedCurveNote from './LastUsedCurveNote.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { curveEquation, curveLabel, formatEquation } from '$lib/standardCurves';
	import { kindLabel, measuringInstruments } from '$lib/instruments/kind';

	// Stored-curve dropdown (instrument -> its standard_curves) with a
	// manual slope/intercept fallback. Writes the resolved selection to `value`.
	// Given a site and the parameter the curve corrects, it opens on the instrument and curve the
	// last grab there recorded.
	let {
		title,
		required = false,
		value = $bindable(emptyCurveSelection()),
		siteId = null,
		parameterId = null,
		parameterCode = null,
	}: {
		title: string;
		required?: boolean;
		value: CurveSelection;
		siteId?: string | null;
		parameterId?: string | null;
		parameterCode?: string | null;
	} = $props();

	type Mode = 'stored' | 'manual';
	let mode = $state<Mode>('stored');

	let instruments = $state<Sensor[]>([]);
	let selectedInstrumentId = $state('');
	let curves = $state<StandardCurve[]>([]);
	let loadingCurves = $state(false);
	let selectedCurveId = $state('');

	let manualSlope = $state('');
	let manualIntercept = $state('');

	const selectedCurve = $derived(curves.find((c) => c.id === selectedCurveId) ?? null);

	function instrumentLabel(instrument: Sensor): string {
		const name = instrument.name ?? instrument.serial_number ?? instrument.id;
		return `${name} (${kindLabel(instrument)})`;
	}

	function curveOptionLabel(c: StandardCurve): string {
		const r2 = c.r_squared != null ? `, R² ${c.r_squared}` : '';
		return `${curveLabel(c)}: ${curveEquation(c)}${r2}`;
	}

	function publish() {
		if (mode === 'stored' && selectedCurve) {
			value = {
				standardCurveId: selectedCurve.id,
				slope: selectedCurve.slope,
				intercept: selectedCurve.intercept,
				label: curveLabel(selectedCurve),
			};
		} else if (mode === 'manual') {
			const s = Number(manualSlope);
			const i = Number(manualIntercept);
			const ok =
				manualSlope !== '' && manualIntercept !== '' && Number.isFinite(s) && Number.isFinite(i);
			value = ok
				? { standardCurveId: null, slope: s, intercept: i, label: `manual ${formatEquation(s, i)}` }
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
			instruments = measuringInstruments(res.data);
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
			const res = await api.standardCurves.list({
				perPage: 200,
				filter: { sensor_id: sensorId },
				sort: ['created_at', 'DESC'],
			});
			curves = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load standard curves');
		} finally {
			loadingCurves = false;
		}
	}

	$effect(() => {
		void loadInstruments();
	});

	// What the last grab at (site, parameter) was measured on and corrected with. Applied only
	// while the picker is still empty, so a choice already made is never overwritten by a lookup
	// that resolves later.
	let lastUsed = $state<LastUsedCurve | null>(null);
	let lastUsedKey = '';
	async function applyLastUsed(site: string, by: { parameterId: string | null; parameterCode: string | null }) {
		try {
			const res = await getLastUsedCurve(site, by);
			lastUsed = res.sensor_id ? res : null;
			if (!res.sensor_id || selectedInstrumentId || value.slope !== null) return;
			selectedInstrumentId = res.sensor_id;
			await loadCurves(res.sensor_id);
			if (res.standard_curve_id && curves.some((c) => c.id === res.standard_curve_id)) {
				selectedCurveId = res.standard_curve_id;
				publish();
			}
		} catch {
			lastUsed = null;
		}
	}
	$effect(() => {
		if (!siteId || (!parameterId && !parameterCode)) return;
		const key = `${siteId}:${parameterId ?? ''}:${parameterCode ?? ''}`;
		if (key === lastUsedKey) return;
		lastUsedKey = key;
		void applyLastUsed(siteId, { parameterId, parameterCode });
	});

	// A selection can arrive already made (a test case carrying literal coefficients, a form
	// prefilled from an earlier run). Adopt it once, so the controls show what `value` holds
	// instead of an empty picker sitting over a live selection.
	let adopted = false;
	$effect(() => {
		if (adopted) return;
		adopted = true;
		if (value.standardCurveId === null && value.slope !== null && value.intercept !== null) {
			mode = 'manual';
			manualSlope = String(value.slope);
			manualIntercept = String(value.intercept);
		}
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
		<LastUsedCurveNote last={lastUsed} />
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
				<p class="text-xs text-brand-muted">No standard curves on this instrument</p>
			{:else}
				<select
					bind:value={selectedCurveId}
					onchange={publish}
					aria-label="{title} curve"
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value=""> - Select curve - </option>
					{#each curves as c}
						<option value={c.id}>{curveOptionLabel(c)}</option>
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
		<p class="text-xs text-brand-muted">{formatEquation(value.slope, value.intercept)}</p>
	{:else if !required}
		<p class="text-xs text-brand-muted">No correction applied</p>
	{/if}
</div>
