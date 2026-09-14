<script lang="ts">
	// A site takes barometric pressure from the nearest MeteoSwiss SMN station. The station is
	// chosen from the published list rather than typed, and the subscription is its own row, so it
	// is attached and detached here rather than saved with the site.
	import { api, type MeteoswissSubscription } from '$api/crud';
	import { getMeteoswissStations, type MeteoswissStation } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';

	let { siteId }: { siteId: string } = $props();

	// The variables the feed declares. Station-level pressure is the only one until another is
	// declared on the API side.
	const VARIABLES = [{ value: 'prestas0', label: 'Barometric pressure' }];

	let subscriptions = $state<MeteoswissSubscription[]>([]);
	let candidates = $state<MeteoswissStation[]>([]);
	let term = $state('');
	let variable = $state(VARIABLES[0].value);
	let loading = $state(true);
	let searching = $state(false);
	let saving = $state('');

	async function loadSubscriptions() {
		const res = await api.meteoswissSubscriptions.list({
			perPage: 100,
			filter: { site_id: siteId },
		});
		subscriptions = res.data;
	}

	async function search() {
		searching = true;
		try {
			candidates = await getMeteoswissStations({ q: term || undefined, site_id: siteId });
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to read the station list');
		} finally {
			searching = false;
		}
	}

	$effect(() => {
		void siteId;
		loading = true;
		Promise.all([loadSubscriptions(), search()])
			.catch((e) => toastStore.error(e instanceof Error ? e.message : 'Failed to load'))
			.finally(() => (loading = false));
	});

	async function attach(station: MeteoswissStation) {
		saving = station.station_abbr;
		try {
			await api.meteoswissSubscriptions.create({
				site_id: siteId,
				station_abbr: station.station_abbr,
				variable,
			});
			await loadSubscriptions();
			toastStore.success(`Subscribed to ${station.station_abbr}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to subscribe');
		} finally {
			saving = '';
		}
	}

	async function detach(subscription: MeteoswissSubscription) {
		saving = subscription.id;
		try {
			await api.meteoswissSubscriptions.remove(subscription.id);
			await loadSubscriptions();
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to remove the subscription');
		} finally {
			saving = '';
		}
	}

	const attached = $derived(new Set(subscriptions.map((s) => `${s.station_abbr}:${s.variable}`)));

	function elevation(station: MeteoswissStation): string {
		const height = station.height_barometer_masl ?? station.height_masl;
		return height == null ? '-' : `${Math.round(height)} m`;
	}

	function distance(station: MeteoswissStation): string {
		return station.distance_km == null ? '-' : `${station.distance_km.toFixed(1)} km`;
	}

	function label(variable: string): string {
		return VARIABLES.find((v) => v.value === variable)?.label ?? variable;
	}
</script>

<section class="space-y-3">
	<div>
		<h3 class="text-sm font-semibold">MeteoSwiss</h3>
		<p class="text-xs text-brand-muted">
			Pressure from an SMN station, used to correct oxygen saturation. Candidates are ranked by
			distance once the site has coordinates.
		</p>
	</div>

	{#if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		{#if subscriptions.length > 0}
			<ul class="space-y-1">
				{#each subscriptions as subscription (subscription.id)}
					<li class="flex items-center justify-between rounded border border-brand-border px-3 py-2">
						<span class="text-sm">
							<span class="font-medium">{subscription.station_abbr}</span>
							<span class="text-brand-muted"> · {label(subscription.variable)}</span>
							{#if !subscription.enabled}<span class="text-brand-muted"> · paused</span>{/if}
						</span>
						<Button
							variant="secondary"
							disabled={saving === subscription.id}
							onclick={() => void detach(subscription)}>Remove</Button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-brand-muted">No station. This site's pressure is not fed.</p>
		{/if}

		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<label for="ms-search" class="text-xs font-medium text-brand-muted">Station</label>
				<input
					id="ms-search"
					bind:value={term}
					oninput={() => void search()}
					placeholder="Abbreviation or name"
					class="rounded border border-brand-border bg-brand-surface px-2 py-1 text-sm"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label for="ms-variable" class="text-xs font-medium text-brand-muted">Variable</label>
				<select
					id="ms-variable"
					bind:value={variable}
					class="rounded border border-brand-border bg-brand-surface px-2 py-1 text-sm"
				>
					{#each VARIABLES as v (v.value)}
						<option value={v.value}>{v.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if searching}
			<p class="text-sm text-brand-muted">Searching…</p>
		{:else if candidates.length === 0}
			<p class="text-sm text-brand-muted">
				No station matches. The list is refreshed by the MeteoSwiss job.
			</p>
		{:else}
			<ul class="max-h-64 space-y-1 overflow-y-auto">
				{#each candidates.slice(0, 25) as station (station.station_abbr)}
					<li class="flex items-center justify-between rounded px-3 py-1.5 hover:bg-brand-surface">
						<span class="text-sm">
							<span class="font-medium">{station.station_abbr}</span>
							<span> {station.name}</span>
							<span class="text-brand-muted"> · {elevation(station)} · {distance(station)}</span>
						</span>
						<Button
							variant="secondary"
							disabled={saving === station.station_abbr ||
								attached.has(`${station.station_abbr}:${variable}`)}
							onclick={() => void attach(station)}>Add</Button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
