<script lang="ts" module>
	export interface CurveSelection {
		// Set when the slope/intercept came from a stored standard_curves row.
		standardCurveId: string | null;
		// The instrument the stored curve belongs to; a write naming a curve names it too.
		sensorId?: string | null;
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
	import { me } from '$auth/me.svelte';
	import LastUsedCurveNote from './LastUsedCurveNote.svelte';
	import NewStandardCurveForm from '$components/sensors/NewStandardCurveForm.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { curveEquation, curveIdentity, curveLabel, formatEquation } from '$lib/standardCurves';
	import { instrumentFilter, kindLabel, measuringInstruments, retiredSuffix } from '$lib/instruments/kind';

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
	// A curve fitted on an instrument that has since been retired still corrects a value measured
	// on it, so the list can be asked for the whole inventory.
	let showRetired = $state(false);
	let selectedInstrumentId = $state('');
	let curves = $state<StandardCurve[]>([]);
	let loadingCurves = $state(false);
	let selectedCurveId = $state('');

	let manualSlope = $state('');
	let manualIntercept = $state('');

	// A curve is fitted in the lab and used at the bench in the same session, so it is created here
	// rather than only on the instrument's own page: an instrument carrying none is otherwise a dead
	// end that the manual arm gets past without cataloguing anything.
	let createOpen = $state(false);
	const canCreate = $derived(me.can('writeFieldMetadata'));

	function curveCreated(curve: StandardCurve) {
		curves = [curve, ...curves];
		selectedCurveId = curve.id;
		createOpen = false;
		publish();
	}

	const selectedCurve = $derived(curves.find((c) => c.id === selectedCurveId) ?? null);

	// A synced row labels a portal's analyte, not a physical device, so the source it came from is
	// named beside it rather than left to be read as an instrument the lab owns.
	function instrumentLabel(instrument: Sensor): string {
		const name = instrument.name ?? instrument.serial_number ?? instrument.id;
		const source = instrument.source_system ? `, from ${instrument.source_system}` : '';
		return `${name} (${kindLabel(instrument)}${source})${retiredSuffix(instrument)}`;
	}

	function curveOptionLabel(c: StandardCurve): string {
		const r2 = c.r_squared != null ? `, R² ${c.r_squared}` : '';
		return `${curveIdentity(c)}: ${curveEquation(c)}${r2}`;
	}

	function publish() {
		if (mode === 'stored' && selectedCurve) {
			value = {
				standardCurveId: selectedCurve.id,
				sensorId: selectedCurve.sensor_id,
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
		try {
			const res = await api.sensors.list({
				perPage: 1000,
				filter: instrumentFilter(showRetired),
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
		createOpen = false;
		publish();
		if (!sensorId) return;
		await fetchCurves(sensorId);
	}

	/** The instrument's offerable curves, plus `keep` where a selection already names one. */
	async function fetchCurves(sensorId: string, keep?: string) {
		loadingCurves = true;
		try {
			const res = await api.standardCurves.list({
				perPage: 200,
				filter: { sensor_id: sensorId },
				sort: ['fitted_on', 'DESC'],
			});
			// A retired curve is out of circulation: the lab has finished with it, so it is not
			// offered for a new measurement. The readings already corrected with it keep it, and so
			// does a run reopened on it.
			curves = res.data.filter((c) => !c.retired_at || c.id === keep);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load standard curves');
		} finally {
			loadingCurves = false;
		}
	}

	/**
	 * Open the controls on a stored curve the caller arrived with, which is a reopened run replaying
	 * what it chose (Q192). The selection names the curve alone, so the instrument that lists it is
	 * read from the curve itself.
	 */
	async function adoptStored(curveId: string) {
		let curve: StandardCurve;
		try {
			curve = await api.standardCurves.get(curveId);
		} catch {
			return;
		}
		if (!instruments.some((i) => i.id === curve.sensor_id)) showRetired = true;
		selectedInstrumentId = curve.sensor_id;
		await fetchCurves(curve.sensor_id, curveId);
		selectedCurveId = curveId;
		publish();
	}

	// Reads `showRetired`, so turning retired instruments on reloads the list.
	$effect(() => {
		void loadInstruments();
	});

	// What the last grab at (site, parameter) was measured on and corrected with. The instrument is
	// filled in because it is what lists the curves; the curve is offered and never applied. A
	// stored `standard_curve_id` exists only because a person picked that curve for that value, and
	// no curve at all is a legitimate state, so a control nobody touched carries nothing.
	let lastUsed = $state<LastUsedCurve | null>(null);
	let lastUsedKey = '';
	async function applyLastUsed(site: string, by: { parameterId: string | null; parameterCode: string | null }) {
		try {
			const res = await getLastUsedCurve(site, by);
			lastUsed = res.sensor_id ? res : null;
			// A slot that already carries a curve was given it by a person, here or in the run this
			// form reopened, so the note is shown and nothing is applied over it.
			if (!res.sensor_id || selectedInstrumentId || value.standardCurveId || value.slope !== null)
				return;
			selectedInstrumentId = res.sensor_id;
			await loadCurves(res.sensor_id);
		} catch {
			lastUsed = null;
		}
	}

	/** Take the curve the note names, which is the operator declaring it. */
	async function useLastUsed() {
		const curveId = lastUsed?.standard_curve_id;
		if (!curveId) return;
		if (lastUsed?.sensor_id && selectedInstrumentId !== lastUsed.sensor_id) {
			selectedInstrumentId = lastUsed.sensor_id;
			await loadCurves(lastUsed.sensor_id);
		}
		if (!curves.some((c) => c.id === curveId)) return;
		selectedCurveId = curveId;
		publish();
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
		if (value.standardCurveId) {
			void adoptStored(value.standardCurveId);
		} else if (value.slope !== null && value.intercept !== null) {
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
		<LastUsedCurveNote last={lastUsed} canUse={!!lastUsed?.standard_curve_id} onuse={useLastUsed} />
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
		<label class="flex items-center gap-1.5 text-xs text-brand-muted cursor-pointer">
			<input type="checkbox" bind:checked={showRetired} />
			Show retired instruments
		</label>
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
			{#if canCreate && !loadingCurves}
				{#if createOpen}
					<NewStandardCurveForm
						sensorId={selectedInstrumentId}
						oncreated={curveCreated}
						oncancel={() => (createOpen = false)}
					/>
				{:else}
					<button
						type="button"
						onclick={() => (createOpen = true)}
						class="self-start text-xs text-brand-primary underline"
					>Add a curve to this instrument</button>
				{/if}
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
