<script lang="ts">
	import { api, type Site, type SiteParameter, type Parameter } from '$api/crud';
	import { saveGrabSample } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zoneOptions =
		typeof Intl.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: [browserZone, 'UTC'];

	// Persists a tool's computed result back to a station as a single grab-sample
	// reading. The result map from a tool is a flat object of numeric outputs; the
	// caller picks which one is the primary value to save (pre-filled, editable).
	let {
		open = $bindable(false),
		toolTitle = '',
		results = null,
	}: {
		open: boolean;
		toolTitle?: string;
		results?: Record<string, unknown> | null;
	} = $props();

	// Flat list of numeric result fields the user can choose to save.
	const numericFields = $derived(
		Object.entries(results ?? {})
			.filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number))
			.map(([key, v]) => ({ key, value: v as number })),
	);

	// Best-guess primary output: first numeric field that isn't a standard deviation.
	function primaryKey(fields: { key: string; value: number }[]): string {
		const preferred = fields.find((f) => !/_(sd|std|stdev|stddev)$/i.test(f.key));
		return (preferred ?? fields[0])?.key ?? '';
	}

	let sites = $state<Site[]>([]);
	let siteParams = $state<SiteParameter[]>([]);
	let params = $state<Parameter[]>([]);

	let selectedSiteId = $state('');
	let selectedParamId = $state('');
	let selectedFieldKey = $state('');
	let collectedAt = $state(toDatetimeLocal(Date.now(), browserZone));
	let collectedZone = $state(browserZone);
	let value = $state('');
	let label = $state('');

	let loadingSite = $state(false);
	let saving = $state(false);

	// Reset and (re)load sites each time the dialog opens.
	$effect(() => {
		if (!open) return;
		selectedSiteId = '';
		selectedParamId = '';
		siteParams = [];
		collectedAt = toDatetimeLocal(Date.now(), browserZone);
		collectedZone = browserZone;
		label = '';
		selectedFieldKey = primaryKey(numericFields);
		value = selectedFieldKey
			? String(numericFields.find((f) => f.key === selectedFieldKey)?.value ?? '')
			: '';
		void loadSites();
	});

	async function loadSites() {
		if (sites.length > 0) return;
		try {
			const [s, p] = await Promise.all([
				api.sites.list({ perPage: 200, sort: ['name', 'ASC'] }),
				api.parameters.list({ perPage: 500 }),
			]);
			sites = s.data;
			params = p.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load sites');
		}
	}

	// Reload the site's parameters whenever the chosen site changes.
	async function loadSiteParameters(siteId: string) {
		selectedParamId = '';
		siteParams = [];
		if (!siteId) return;
		loadingSite = true;
		try {
			const res = await api.siteParameters.list({ perPage: 500, filter: { site_id: siteId } });
			siteParams = res.data;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to load site parameters');
		} finally {
			loadingSite = false;
		}
	}

	function paramLabel(sp: SiteParameter): string {
		const param = params.find((p) => p.id === sp.parameter_id);
		const name = param?.name ?? sp.name ?? sp.parameter_id;
		const units = sp.display_units ?? param?.default_units ?? '';
		return units ? `${name} (${units})` : name;
	}

	function onPickField() {
		const f = numericFields.find((f) => f.key === selectedFieldKey);
		if (f) value = String(f.value);
	}

	const canSave = $derived(
		!!selectedSiteId && !!selectedParamId && !!collectedAt && Number.isFinite(Number(value)) && value !== '',
	);

	async function handleSave() {
		if (!canSave) {
			toastStore.error('Select a site, a parameter, and enter a numeric value');
			return;
		}
		saving = true;
		try {
			const res = await saveGrabSample({
				site_id: selectedSiteId,
				readings: [
					{
						parameter_id: selectedParamId,
						time: fromDatetimeLocal(collectedAt, collectedZone),
						value: Number(value),
						replicate_index: 0,
					},
				],
			});
			const note = label.trim() ? ` (${label.trim()})` : '';
			toastStore.success(`Saved ${res.inserted} reading to station${note}`);
			open = false;
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to save to station');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title="Save to Station{toolTitle ? `: ${toolTitle}` : ''}" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="flex flex-col gap-1">
				<label for="sts-site" class="text-sm font-medium">Site <span class="text-severity-alarm">*</span></label>
				<select
					id="sts-site"
					bind:value={selectedSiteId}
					onchange={() => loadSiteParameters(selectedSiteId)}
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
				>
					<option value=""> - Select site - </option>
					{#each sites as s}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1">
				<label for="sts-param" class="text-sm font-medium">Parameter <span class="text-severity-alarm">*</span></label>
				<select
					id="sts-param"
					bind:value={selectedParamId}
					disabled={!selectedSiteId || loadingSite}
					class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm disabled:opacity-50"
				>
					<option value="">{loadingSite ? 'Loading…' : !selectedSiteId ? 'Select a site first' : siteParams.length ? ' - Select parameter - ' : 'No parameters at this site'}</option>
					{#each siteParams as sp}
						<option value={sp.parameter_id}>{paramLabel(sp)}</option>
					{/each}
				</select>
			</div>

			{#if numericFields.length > 1}
				<div class="flex flex-col gap-1">
					<label for="sts-field" class="text-sm font-medium">Result field</label>
					<select
						id="sts-field"
						bind:value={selectedFieldKey}
						onchange={onPickField}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						{#each numericFields as f}
							<option value={f.key}>{f.key.replace(/_/g, ' ')} = {f.value.toPrecision(6)}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="sts-time" class="text-sm font-medium">Timestamp <span class="text-severity-alarm">*</span></label>
					<input id="sts-time" type="datetime-local" bind:value={collectedAt} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
					<select bind:value={collectedZone} aria-label="Time zone" class="px-3 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs">
						{#each zoneOptions as z}<option value={z}>{z}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="sts-value" class="text-sm font-medium">Value <span class="text-severity-alarm">*</span></label>
					<input id="sts-value" type="number" step="any" bind:value class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
				</div>
			</div>

			<div class="flex flex-col gap-1">
				<label for="sts-label" class="text-sm font-medium">Label / note <span class="text-brand-muted font-normal">(optional)</span></label>
				<input id="sts-label" type="text" bind:value={label} placeholder="e.g. field campaign, lab batch…" class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
			</div>

			<p class="text-xs text-brand-muted">
				Saves the value as a single grab-sample reading on the selected site parameter.
			</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			onclick={handleSave}
			disabled={saving || !canSave}
		>{saving ? 'Saving…' : 'Save'}</Button>
	{/snippet}
</Dialog>
