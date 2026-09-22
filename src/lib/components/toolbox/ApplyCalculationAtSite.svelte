<script lang="ts">
	import { api, type Parameter } from '$api/crud';
	import { listToolScripts, applyCalculationAtSite, type ToolScriptSummary } from '$api/service';
	import { calculationApplyPreview, type CalculationApplyPreview } from '$lib/calculations/apply';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';

	// Applying a calculation is checked before it is written: the panel reads the dry run and shows
	// the reads the site declares, the ones it does not, and the output columns the apply adds.
	// The side that is fixed by the host is the one that gets no picker: a calculation's page picks
	// a site, a site's page picks a calculation.
	let {
		calculationId = null,
		siteId = null,
		onapplied = null,
	}: {
		calculationId?: string | null;
		siteId?: string | null;
		onapplied?: (() => void) | null;
	} = $props();

	// Only the side the host left open is picked here, so each picker starts empty and the fixed
	// side comes straight from the prop.
	let chosenSite = $state('');
	let chosenCalculation = $state('');
	let calculations = $state<ToolScriptSummary[]>([]);
	let parameters = $state<Parameter[]>([]);
	let preview = $state<CalculationApplyPreview | null>(null);
	let refusal = $state('');
	let reading = $state(false);
	let applying = $state(false);

	const site = $derived(siteId ?? chosenSite);
	const calculation = $derived(calculationId ?? chosenCalculation);

	$effect(() => {
		if (calculationId) return;
		void listToolScripts()
			.then((items) => {
				calculations = items.filter((c) => c.enabled);
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

	async function read() {
		preview = null;
		refusal = '';
		if (!site || !calculation) return;
		reading = true;
		try {
			preview = calculationApplyPreview(await applyCalculationAtSite(site, calculation, true), nameOf);
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
			await read();
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
		A calculation applies where the site measures everything it reads. Applying it adds the output
		columns it publishes; nothing else at the site changes.
	</p>
	<div class="flex items-end gap-3">
		<div class="flex-1">
			{#if siteId}
				<label for="apply-calculation-select" class="text-xs font-medium block mb-1">Calculation</label>
				<select
					id="apply-calculation-select"
					bind:value={chosenCalculation}
					onchange={() => void read()}
					class="w-full px-3 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface"
				>
					<option value="">Select a calculation…</option>
					{#each calculations as c (c.id)}
						<option value={c.id}>{c.label || c.name}</option>
					{/each}
				</select>
			{:else}
				<label for="apply-calculation-site" class="text-xs font-medium block mb-1">Site</label>
				<SiteSelect
					id="apply-calculation-site"
					bind:value={chosenSite}
					ariaLabel="Site to apply this calculation at"
					class="w-full px-3 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface"
					onchange={() => void read()}
				/>
			{/if}
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
