<script lang="ts">
	import {
		pinReadings,
		rollbackPinSet,
		type PinKind,
		type PinResponse,
	} from '$api/service';
	import { api, type Sensor, type SensorCalibration } from '$api/crud';
	import { measuringInstruments } from '$lib/instruments/kind';
	import { fromDatetimeLocal, toDatetimeLocal } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// A pin over a window: one decision per reading in one set, honoured by every later reprocess
	// instead of the calibration window it would otherwise resolve. The per-reading pin on a
	// reading's own record is the same decision over one instant; this is how a person says "the
	// whole of last week was the spare probe" without opening a hundred records.
	let {
		open = $bindable(false),
		siteId,
		parameterId,
		parameterName,
	}: {
		open: boolean;
		siteId: string;
		parameterId: string;
		parameterName: string;
	} = $props();

	let kind = $state<PinKind>('instrument');
	let targetId = $state('');
	let from = $state('');
	let to = $state('');
	let reason = $state('');
	let busy = $state(false);
	let error = $state('');
	let done = $state<PinResponse | null>(null);
	let instruments = $state<Sensor[]>([]);
	let calibrations = $state<SensorCalibration[]>([]);

	$effect(() => {
		if (!open) return;
		error = '';
		done = null;
		void loadTargets();
	});

	async function loadTargets() {
		const [sensors, cals] = await Promise.all([
			api.sensors.list({ perPage: 500, sort: ['name', 'ASC'], filter: { is_active: true } }),
			api.sensorCalibrations.list({ perPage: 500, sort: ['valid_from', 'DESC'] }),
		]);
		instruments = measuringInstruments(sensors.data);
		calibrations = cals.data;
	}

	const targets = $derived(
		kind === 'instrument'
			? instruments.map((s) => ({ value: s.id, label: s.name ?? s.serial_number ?? s.id }))
			: calibrations.map((c) => ({
					value: c.id,
					label: `${c.slope} × raw + ${c.intercept} from ${c.valid_from.slice(0, 10)}`,
				})),
	);

	const ready = $derived(Boolean(targetId && from && to && from < to));

	async function pin() {
		if (!ready) return;
		busy = true;
		error = '';
		try {
			done = await pinReadings(
				kind,
				targetId,
				{
					site_id: siteId,
					parameter_id: parameterId,
					from: fromDatetimeLocal(from),
					to: fromDatetimeLocal(to),
				},
				reason || undefined,
			);
			toastStore.success(`${done.rows_decided} readings pinned`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function undo() {
		if (!done) return;
		busy = true;
		error = '';
		try {
			const res = await rollbackPinSet(done.set_id);
			toastStore.success(`${res.rolled_back} pins rolled back`);
			done = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog bind:open title="Pin readings of {parameterName}">
	<div class="space-y-3 text-sm">
		{#if done}
			<p>
				<strong>{done.rows_decided}</strong> readings are pinned, and
				<strong>{done.jobs.length}</strong> slot reprocess{done.jobs.length === 1 ? '' : 'es'} will
				make their corrections follow the pin.
			</p>
			<p class="text-xs text-brand-muted">
				Reversible: rolling the set back inverts every one of those decisions and reprocesses the
				slot again, so the readings return to what the window resolves.
			</p>
			<div class="flex gap-2">
				<Button variant="ghost" loading={busy} onclick={undo}>Roll the set back</Button>
				<Button onclick={() => (open = false)}>Close</Button>
			</div>
		{:else}
			<label class="block">
				<span class="block text-brand-muted mb-1">Pin to</span>
				<select bind:value={kind} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface">
					<option value="instrument">An instrument</option>
					<option value="calibration">A calibration</option>
				</select>
			</label>
			<label class="block">
				<span class="block text-brand-muted mb-1"
					>{kind === 'instrument' ? 'Instrument' : 'Calibration'}</span
				>
				<select bind:value={targetId} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface w-full">
					<option value="">Select…</option>
					{#each targets as t (t.value)}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>
			</label>
			<div class="flex gap-2">
				<label class="block">
					<span class="block text-brand-muted mb-1">From</span>
					<input type="datetime-local" bind:value={from} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface" />
				</label>
				<label class="block">
					<span class="block text-brand-muted mb-1">To</span>
					<input type="datetime-local" bind:value={to} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface" />
				</label>
			</div>
			<label class="block">
				<span class="block text-brand-muted mb-1">Reason</span>
				<input bind:value={reason} class="border border-brand-divider rounded px-2 py-1 bg-brand-surface w-full" placeholder="logged by the spare probe" />
			</label>
			<p class="text-xs text-brand-muted">
				Every reading of this parameter at this site in the window takes the pin, and every later
				reprocess honours it instead of resolving the window. The raw measurements are unchanged,
				and the whole set is reversible from here.
			</p>
			{#if error}<ErrorNotice message={error} />{/if}
			<div class="flex gap-2">
				<Button variant="primary" loading={busy} disabled={!ready} onclick={pin}>Pin the window</Button>
				<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			</div>
		{/if}
	</div>
</Dialog>
