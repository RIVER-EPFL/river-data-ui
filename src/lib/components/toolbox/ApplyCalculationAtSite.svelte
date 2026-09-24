<script lang="ts">
	import { api, type Parameter } from '$api/crud';
	import { listToolScripts, applyCalculationAtSite, type ToolScriptSummary } from '$api/service';
	import { calculationApplyPreview, type CalculationApplyPreview } from '$lib/calculations/apply';
	import { apiMessage } from '$lib/standardCurves';
	import { findCalculation } from '$lib/toolbox/route';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';

	// Applying a calculation is checked before it is written: the panel reads the dry run and shows
	// the reads the site declares, the ones it does not, and the output columns the apply adds.
	// The site's Parameters tab is the one place a calculation is applied: the site is fixed and the
	// calculation is picked.
	let {
		siteId,
		chosen = null,
		onapplied = null,
	}: {
		siteId: string;
		/** A calculation to open on, by id or name, as a link from the Toolbox names it. */
		chosen?: string | null;
		onapplied?: (() => void) | null;
	} = $props();

	let chosenCalculation = $state('');
	let calculations = $state<ToolScriptSummary[]>([]);
	let parameters = $state<Parameter[]>([]);
	let preview = $state<CalculationApplyPreview | null>(null);
	let refusal = $state('');
	let reading = $state(false);
	let applying = $state(false);

	const site = $derived(siteId);
	const calculation = $derived(chosenCalculation);

	$effect(() => {
		void listToolScripts()
			.then((items) => {
				calculations = items.filter((c) => !c.decommissioned_at);
				if (chosen) chosenCalculation = findCalculation(calculations, chosen)?.id ?? '';
			})
			.catch(() => {
				calculations = [];
			});
	});

	$effect(() => {
		void api.parameters
			.list({ perPage: 500 })
			.then((p) => {
				parameters = p.data;
			})
			.catch(() => {
				parameters = [];
			});
	});

	const nameOf = (id: string) => parameters.find((p) => p.id === id)?.name ?? null;

	// The dry run follows the chosen calculation, so the panel reads without anything to click.
	$effect(() => {
		void read(site, calculation);
	});

	async function read(atSite: string, forCalculation: string) {
		preview = null;
		refusal = '';
		if (!atSite || !forCalculation) return;
		reading = true;
		try {
			preview = calculationApplyPreview(
				await applyCalculationAtSite(atSite, forCalculation, true),
				nameOf,
			);
		} catch (e) {
			refusal = apiMessage(e);
		} finally {
			reading = false;
		}
	}

	async function apply() {
		if (!site || !calculation) return;
		applying = true;
		try {
			const applied = await applyCalculationAtSite(site, calculation);
			toastStore.success(
				applied.outputs_created.length === 0
					? 'Already applied here'
					: `${applied.outputs_created.length} output parameter${applied.outputs_created.length === 1 ? '' : 's'} added`,
			);
			await read(site, calculation);
			onapplied?.();
		} catch (e) {
			refusal = apiMessage(e);
			toastStore.error(refusal);
		} finally {
			applying = false;
		}
	}

	function slotList(slots: CalculationApplyPreview['inputsPresent']): string {
		return slots.map((s) => `${s.name} (${s.code})`).join(', ');
	}
</script>

<div class="space-y-2">
	<p class="text-xs text-brand-muted">
		A calculation runs only at the sites it was added to. Adding it here needs every parameter it
		reads measured at the site, and adds the output columns it publishes; nothing else at the site
		changes.
	</p>
	<div class="flex items-end gap-3">
		<div class="flex-1">
			<label for="apply-calculation-select" class="text-xs font-medium block mb-1">Calculation</label>
			<select
				id="apply-calculation-select"
				bind:value={chosenCalculation}
				class="w-full px-3 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface"
			>
				<option value="">Select a calculation…</option>
				{#each calculations as c (c.id)}
					<option value={c.id}>{c.label || c.name}</option>
				{/each}
			</select>
		</div>
		<Button
			variant="primary"
			size="sm"
			onclick={apply}
			disabled={!site || !calculation || reading || applying || preview?.applicable === false || preview?.complete === true}
		>{applying ? 'Applying…' : 'Apply'}</Button>
	</div>

	{#if reading}
		<p class="text-xs text-brand-muted">Reading what this would add…</p>
	{:else if refusal}
		<p class="text-xs text-severity-alarm">{refusal}</p>
	{:else if preview}
		<dl class="grid gap-3 sm:grid-cols-2 text-xs m-0">
			<div>
				<dt class="font-medium mb-1">Reads, measured here ({preview.inputsPresent.length})</dt>
				<dd class="m-0 text-brand-muted">{slotList(preview.inputsPresent) || 'Nothing: this calculation reads only constants and site properties.'}</dd>
			</div>
			<div>
				<dt class="font-medium mb-1">Reads, not measured here ({preview.inputsMissing.length})</dt>
				<dd class="m-0 {preview.inputsMissing.length > 0 ? 'text-severity-alarm' : 'text-brand-muted'}">{slotList(preview.inputsMissing) || 'None.'}</dd>
			</div>
			<div>
				<dt class="font-medium mb-1">Outputs to add ({preview.outputsAdding.length})</dt>
				<dd class="m-0 text-brand-muted">{slotList(preview.outputsAdding) || 'None.'}</dd>
			</div>
			<div>
				<dt class="font-medium mb-1">Outputs already here ({preview.outputsHeld.length})</dt>
				<dd class="m-0 text-brand-muted">{slotList(preview.outputsHeld) || 'None.'}</dd>
			</div>
		</dl>
		{#if !preview.applicable}
			<p class="text-xs text-severity-alarm">Add those parameters to the site before applying this calculation.</p>
		{:else if preview.complete}
			<p class="text-xs text-brand-muted">Already applied here.</p>
		{/if}
	{/if}
</div>
