<script lang="ts">
	// A site takes barometric pressure from the nearest MeteoSwiss SMN station. The station is
	// chosen from the published list rather than typed, and the subscription is its own row, so it
	// is attached and detached here rather than saved with the site.
	import { api, type DataStream, type MeteoswissSubscription, type ReprocessingJob } from '$api/crud';
	import { getMeteoswissStations, type MeteoswissStation } from '$api/service';
	import { feedStatus, latestBackfill, streamKey, type FeedStatus } from '$lib/meteoswiss';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import { onDestroy, untrack } from 'svelte';

	let { siteId }: { siteId: string } = $props();

	// The variables the feed declares. Station-level pressure is the only one until another is
	// declared on the API side.
	const VARIABLES = [{ value: 'prestas0', label: 'Barometric pressure' }];

	let subscriptions = $state<MeteoswissSubscription[]>([]);
	let streams = $state<DataStream[]>([]);
	let backfills = $state<ReprocessingJob[]>([]);
	let candidates = $state<MeteoswissStation[]>([]);
	let term = $state('');
	let variable = $state(VARIABLES[0].value);
	let loading = $state(true);
	let searching = $state(false);
	let searched = $state(false);
	let saving = $state('');

	// One request per keystroke is one page reflow per keystroke, and the answers arrive out of
	// order; the term the reader has stopped typing is the only one worth asking about.
	const SEARCH_DELAY_MS = 250;
	let searchTimer: ReturnType<typeof setTimeout>;
	let latestSearch = 0;

	async function loadSubscriptions() {
		const [subs, feeds, jobs] = await Promise.all([
			api.meteoswissSubscriptions.list({ perPage: 100, filter: { site_id: siteId } }),
			api.dataStreams.list({ perPage: 200, filter: { source_system: 'meteoswiss' } }),
			api.reprocessingJobs.list({
				perPage: 100,
				sort: ['created_at', 'DESC'],
				filter: { trigger_type: 'meteoswiss_backfill' },
			}),
		]);
		subscriptions = subs.data;
		streams = feeds.data;
		backfills = jobs.data;
	}

	// The candidate list stays on screen while a search runs: replacing it with a line of text
	// shortens the page under the reader, and this panel sits at the bottom of the site form, so
	// the scroll position is clamped to the top on every keystroke.
	async function search() {
		const request = ++latestSearch;
		searching = true;
		try {
			const found = await getMeteoswissStations({ q: term || undefined, site_id: siteId, variable });
			if (request !== latestSearch) return;
			candidates = found;
			searched = true;
		} catch (e) {
			if (request !== latestSearch) return;
			toastStore.error(e instanceof Error ? e.message : 'Failed to read the station list');
		} finally {
			if (request === latestSearch) searching = false;
		}
	}

	function searchLater() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => void search(), SEARCH_DELAY_MS);
	}

	onDestroy(() => clearTimeout(searchTimer));

	// Only the site reloads this panel. `search` reads the term and the variable, so tracking it
	// would make every keystroke reload the subscriptions and fire a second, undebounced request.
	$effect(() => {
		void siteId;
		loading = true;
		untrack(() => Promise.all([loadSubscriptions(), search()]))
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

	function status(subscription: MeteoswissSubscription): FeedStatus {
		const key = streamKey(subscription.station_abbr, subscription.variable, siteId);
		const stream = streams.find((s) => s.source_key === key) ?? null;
		return feedStatus(
			stream,
			latestBackfill(backfills, subscription.station_abbr, subscription.variable)
		);
	}

	function said(state: FeedStatus): string {
		switch (state.kind) {
			case 'flowing':
				return `last value ${formatDateTime(state.at)}`;
			case 'failed':
				return state.message;
			case 'working':
				return 'reading its history…';
			default:
				return 'no data yet';
		}
	}

	function elevation(station: MeteoswissStation): string {
		if (station.publishes === false) return `no ${label(variable).toLowerCase()}`;
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
	<h3 class="text-sm font-semibold">MeteoSwiss</h3>

	{#if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else}
		{#if subscriptions.length > 0}
			<ul class="space-y-1">
				{#each subscriptions as subscription (subscription.id)}
					{@const state = status(subscription)}
					<li class="flex items-center justify-between rounded border border-brand-border px-3 py-2">
						<span class="text-sm">
							<span class="font-medium">{subscription.station_abbr}</span>
							<span class="text-brand-muted"> · {label(subscription.variable)}</span>
							{#if !subscription.enabled}<span class="text-brand-muted"> · paused</span>{/if}
							<span class={state.kind === 'failed' ? 'text-severity-alarm' : 'text-brand-muted'}>
								· {said(state)}
							</span>
						</span>
						<Button
							variant="secondary"
							disabled={saving === subscription.id}
							onclick={() => void detach(subscription)}>Remove</Button
						>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<label for="ms-search" class="text-xs font-medium text-brand-muted">Station</label>
				<div class="flex items-center gap-2">
					<input
						id="ms-search"
						bind:value={term}
						oninput={searchLater}
						placeholder="Abbreviation or name"
						class="rounded border border-brand-border bg-brand-surface px-2 py-1 text-sm"
					/>
					{#if searching}<span class="text-xs text-brand-muted">searching…</span>{/if}
				</div>
			</div>
			<div class="flex flex-col gap-1">
				<label for="ms-variable" class="text-xs font-medium text-brand-muted">Variable</label>
				<select
					id="ms-variable"
					bind:value={variable}
					onchange={() => void search()}
					class="rounded border border-brand-border bg-brand-surface px-2 py-1 text-sm"
				>
					{#each VARIABLES as v (v.value)}
						<option value={v.value}>{v.label}</option>
					{/each}
				</select>
			</div>
		</div>

		{#if searched && candidates.length === 0}
			<p class="text-sm text-brand-muted">
				No station matches. The list is refreshed by the MeteoSwiss job.
			</p>
		{:else}
			<ul class="max-h-64 space-y-1 overflow-y-auto">
				{#each candidates.slice(0, 25) as station (station.station_abbr)}
					<li
						class="flex items-center justify-between rounded px-3 py-1.5 hover:bg-brand-surface"
						class:opacity-50={station.publishes === false}
					>
						<span class="text-sm">
							<span class="font-medium">{station.station_abbr}</span>
							<span> {station.name}</span>
							<span class="text-brand-muted"> · {elevation(station)} · {distance(station)}</span>
						</span>
						<Button
							variant="secondary"
							disabled={saving === station.station_abbr ||
								station.publishes === false ||
								attached.has(`${station.station_abbr}:${variable}`)}
							onclick={() => void attach(station)}>Add</Button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
