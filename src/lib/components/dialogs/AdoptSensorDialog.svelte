<script lang="ts">
	import { api, type Sensor, type Site, type SiteParameter, type SensorDeployment, type Parameter } from '$api/crud';
	import { adoptSensor, swapSensors, getAdoptSuggestions, pollJob } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { toDatetimeLocal, fromDatetimeLocal, formatDateTime } from '$lib/utils';
	import { timezoneStore } from '$lib/stores/timezone.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import { base } from '$app/paths';
	import { formatCount } from '$lib/format';

	let {
		open = $bindable(false),
		sensor,
		sites,
		parameters,
		onsuccess,
	}: {
		open: boolean;
		sensor: Sensor;
		sites: Site[];
		parameters: Parameter[];
		onsuccess?: () => void;
	} = $props();

	let mode = $state<'choose' | 'adopt' | 'import'>('choose');
	let selectedSiteId = $state('');
	let selectedSiteParamId = $state('');
	let deployedFrom = $state(toDatetimeLocal(Date.now(), timezoneStore.zone));
	let working = $state(false);

	// The server's suggested deploy dates, so the operator picks one rather than typing an instant.
	let suggestions = $state<{ now: string; end_of_last_deployment: string | null; first_reading: string | null } | null>(null);
	$effect(() => {
		const id = sensor.id;
		let current = true;
		getAdoptSuggestions(id)
			.then((s) => { if (current) suggestions = s; })
			.catch(() => { if (current) suggestions = null; });
		return () => { current = false; };
	});

	let siteParams = $state<SiteParameter[]>([]);
	let openDeployments = $state<SensorDeployment[]>([]); // active deployments at chosen site

	$effect(() => {
		if (!selectedSiteId) { siteParams = []; openDeployments = []; return; }
		Promise.all([
			api.siteParameters.list({ perPage: 200, filter: { site_id: selectedSiteId } }),
			api.sensorDeployments.list({ perPage: 200, filter: { site_id: selectedSiteId, deployed_until: null } }),
		]).then(([sp, dep]) => { siteParams = sp.data; openDeployments = dep.data; });
	});

	// Swap suggestion: which sensor currently holds the slot this sensor's parameter would occupy.
	const incumbent = $derived.by(() => {
		const sp = siteParams.find((s) => s.id === selectedSiteParamId);
		if (!sp) return null;
		const dep = openDeployments.find((d) => d.parameter_id === sp.parameter_id && d.sensor_id !== sensor.id);
		return dep ?? null;
	});

	function paramName(id: string) { return parameters.find((p) => p.id === id)?.name ?? id; }

	// The incumbent is named by the instrument holding the slot, not by its deployment id: the
	// operator is checking this against a field notebook, which records serials and dates.
	let incumbentSensor = $state<Sensor | null>(null);
	$effect(() => {
		const id = incumbent?.sensor_id;
		if (!id) { incumbentSensor = null; return; }
		let current = true;
		api.sensors
			.get(id)
			.then((s) => { if (current) incumbentSensor = s; })
			.catch(() => { if (current) incumbentSensor = null; });
		return () => { current = false; };
	});

	const incumbentLabel = $derived(
		incumbentSensor
			? [incumbentSensor.serial_number, incumbentSensor.name].filter(Boolean).join(', ') ||
					incumbentSensor.id.slice(0, 8)
			: null,
	);

	// The swap's reprocess is tracked, so what it re-attributed is reported once it lands rather
	// than described as happening somewhere in the background.
	async function reportReprocess(jobId: string) {
		try {
			const job = await pollJob(jobId, { timeoutMs: 120_000 });
			if (job.status !== 'completed') return;
			const n = job.readings_updated ?? 0;
			toastStore.info(`${formatCount(n)} reading${n === 1 ? '' : 's'} re-attributed`);
		} catch {
			// The deployment is written either way; the count is reporting, not the operation.
		}
	}

	// Sensors are parameter-free, so any of the site's parameter slots can be adopted.
	const compatibleSiteParams = $derived(siteParams);

	// The slot the operator picked is the deployment's parameter: a deployment binds a sensor to
	// one parameter at a site, so it cannot be created without one.
	const selectedParameterId = $derived(
		siteParams.find((s) => s.id === selectedSiteParamId)?.parameter_id ?? '',
	);

	// A slot another instrument holds is a swap, which ends that deployment and starts this one at
	// the same instant; an empty slot is an adopt. Both mint the site_parameter row when it is
	// missing and return the tracked reprocess job.
	async function adopt() {
		if (!selectedSiteId || !selectedParameterId || !deployedFrom) return;
		working = true;
		const at = fromDatetimeLocal(deployedFrom, timezoneStore.zone);
		try {
			const jobId = incumbent
				? (
						await swapSensors({
							outgoing_sensor_id: incumbent.sensor_id,
							incoming_sensor_id: sensor.id,
							site_id: selectedSiteId,
							parameter_id: selectedParameterId,
							at,
						})
					).incoming_job_id
				: (
						await adoptSensor(sensor.id, {
							site_id: selectedSiteId,
							parameter_id: selectedParameterId,
							deployed_from: at,
						})
					).job_id;
			toastStore.success(incumbent
				? `Site parameter adopted, ${incumbentLabel ?? 'the incumbent instrument'}'s deployment closed`
				: 'Sensor deployed');
			open = false;
			onsuccess?.();
			void reportReprocess(jobId);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Adopt failed');
		} finally { working = false; }
	}
</script>

<Dialog bind:open title="Add data for {sensor.name ?? sensor.serial_number ?? 'sensor'}" maxWidth="md">
	{#snippet children()}
		{#if mode === 'choose'}
			<div class="grid grid-cols-2 gap-3">
				<button onclick={() => mode = 'adopt'} class="text-left p-4 rounded-md border border-brand-divider hover:border-brand-primary bg-brand-surface cursor-pointer">
					<div class="font-semibold text-sm mb-1">Adopt a site parameter</div>
					<p class="text-xs text-brand-muted">Deploy this sensor onto a site parameter. If another sensor holds it, its deployment is closed at your chosen time (swap).</p>
				</button>
				<a href="{base}/sites" onclick={() => open = false} class="text-left p-4 rounded-md border border-brand-divider hover:border-brand-primary bg-brand-surface no-underline text-brand-text">
					<div class="font-semibold text-sm mb-1">Import a CSV</div>
					<p class="text-xs text-brand-muted">Upload historical readings to a site (Site → Import CSV). Use when the sensor wrote files, not a live stream.</p>
				</a>
			</div>
		{:else if mode === 'adopt'}
			<div class="space-y-3">
				<div class="flex flex-col gap-1">
					<label for="ad-site" class="text-sm font-medium">Site</label>
					<SiteSelect id="ad-site" bind:value={selectedSiteId} {sites} />
				</div>
				{#if selectedSiteId}
					<div class="flex flex-col gap-1">
						<label for="ad-sp" class="text-sm font-medium">Site parameter</label>
						<select id="ad-sp" bind:value={selectedSiteParamId} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm">
							<option value=""> - Select a site parameter - </option>
							{#each compatibleSiteParams as sp}<option value={sp.id}>{sp.name ?? paramName(sp.parameter_id)}</option>{/each}
						</select>
						{#if compatibleSiteParams.length === 0}
							<p class="text-xs text-severity-warning">No parameters configured at this site.</p>
						{/if}
					</div>
					{#if incumbent}
						<div class="p-2 rounded border border-severity-warning-border bg-severity-warning-soft text-xs">
							<span class="font-semibold text-severity-warning">Swap:</span>
							{incumbentLabel ?? `deployment ${incumbent.id.slice(0, 8)}`} holds this slot since
							{formatDateTime(incumbent.deployed_from)}. Adopting closes that deployment at your
							chosen time, and the readings from then on are re-attributed to this instrument.
						</div>
					{/if}
					<div class="flex flex-col gap-1">
						<label for="ad-from" class="text-sm font-medium">Deployed from</label>
						<input id="ad-from" type="datetime-local" bind:value={deployedFrom} class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
						{#if suggestions}
							<div class="flex gap-2 flex-wrap text-xs">
								<button type="button" class="underline text-brand-primary cursor-pointer" onclick={() => (deployedFrom = toDatetimeLocal(suggestions?.now ?? Date.now(), timezoneStore.zone))}>Now</button>
								{#if suggestions.end_of_last_deployment}
									<button type="button" class="underline text-brand-primary cursor-pointer" onclick={() => (deployedFrom = toDatetimeLocal(suggestions?.end_of_last_deployment ?? '', timezoneStore.zone))}>End of its last deployment ({formatDateTime(suggestions.end_of_last_deployment)})</button>
								{/if}
								{#if suggestions.first_reading}
									<button type="button" class="underline text-brand-primary cursor-pointer" onclick={() => (deployedFrom = toDatetimeLocal(suggestions?.first_reading ?? '', timezoneStore.zone))}>Its first reading ({formatDateTime(suggestions.first_reading)})</button>
								{/if}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if mode === 'adopt'}
			<Button onclick={() => mode = 'choose'}>Back</Button>
			<Button variant="primary" onclick={adopt} disabled={working || !selectedSiteId || !selectedSiteParamId || !selectedParameterId || !deployedFrom}>{working ? 'Adopting…' : incumbent ? 'Swap & adopt' : 'Adopt'}</Button>
		{:else}
			<Button onclick={() => open = false}>Close</Button>
		{/if}
	{/snippet}
</Dialog>
