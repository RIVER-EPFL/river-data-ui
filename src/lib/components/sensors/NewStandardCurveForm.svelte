<script lang="ts">
	import { untrack } from 'svelte';
	import { api, type StandardCurve } from '$api/crud';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import { apiMessage, emptyCurveForm, parseCurveForm, type CurveForm } from '$lib/standardCurves';

	// The create form for a standard curve, wherever one is needed: the instrument's own tab and the
	// grab-entry picker, which would otherwise be a dead end on an instrument that carries none.
	let {
		sensorId,
		sensorName = null,
		seed = null,
		oncreated,
		oncancel,
	}: {
		sensorId: string;
		/** Named under the buttons, so it is clear which instrument the curve is recorded against. */
		sensorName?: string | null;
		/** Values to open with; a duplicate is a create seeded from another row. */
		seed?: CurveForm | null;
		oncreated: (curve: StandardCurve) => void;
		oncancel: () => void;
	} = $props();

	let form = $state<CurveForm>(untrack(() => ({ ...emptyCurveForm, ...(seed ?? {}) })));
	let formError = $state('');
	let saving = $state(false);

	async function save() {
		const parsed = parseCurveForm(form);
		if ('error' in parsed) {
			formError = parsed.error;
			return;
		}
		saving = true;
		formError = '';
		try {
			const curve = await api.standardCurves.create({
				sensor_id: sensorId,
				...parsed.values,
			});
			oncreated(curve);
		} catch (e) {
			formError = apiMessage(e);
		} finally {
			saving = false;
		}
	}
</script>

<div class="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-4 space-y-3">
	<h3 class="text-sm font-semibold">New standard curve</h3>
	<div class="grid grid-cols-2 gap-3 max-w-2xl">
		<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">
			Name
			<input type="text" bind:value={form.name} placeholder="Plate or series this curve was fitted from" class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">
			Fit date <span class="text-[10px]">(optional, defaults to today)</span>
			<input type="date" bind:value={form.fitted_on} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Slope
			<input type="number" step="any" bind:value={form.slope} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Intercept
			<input type="number" step="any" bind:value={form.intercept} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			R² <span class="text-[10px]">(optional)</span>
			<input type="number" step="any" bind:value={form.r_squared} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Notes <span class="text-[10px]">(optional)</span>
			<input type="text" bind:value={form.notes} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" />
		</label>
	</div>
	{#if formError}
		<ErrorNotice message={formError} />
	{/if}
	<div class="flex items-center gap-3">
		<Button variant="primary" onclick={save} disabled={saving}>{saving ? 'Saving…' : 'Add curve'}</Button>
		<Button variant="ghost" onclick={oncancel}>Cancel</Button>
		{#if sensorName}
			<span class="text-[11px] text-brand-muted">Recorded against {sensorName}.</span>
		{/if}
	</div>
</div>
