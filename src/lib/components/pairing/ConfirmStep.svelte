<script lang="ts">
	import { base } from '$app/paths';
	import type { PairingPlan } from '$api/service';
	import { sitesWithoutCoordinates } from '$lib/pairing/planGroups';
	import type { Creations, GroupCreation, InstrumentBinding, SiteCreation } from '$lib/pairing/planGroups';
	import Button from '$components/ui/Button.svelte';
	import { formatCount } from '$lib/format';

	// The wizard's Confirm step: what the apply will do, counted from the plan the reviewer just
	// worked, and the one button that does it.
	let {
		plan,
		summary,
		blockedReason,
		familySummary,
		instruments,
		created,
		onsiteattribute,
		ongroupattribute,
		applying,
		applyJobId,
		onback,
		onapply,
	}: {
		plan: PairingPlan;
		/** What the apply will pair, skip and create, counted over every entry. */
		summary: {
			toPair: number;
			toSkip: number;
			total: number;
			warnings: number;
			newSites: number;
			newParams: number;
			newProjects: number;
		};
		/** Why Apply is refused, naming each review tab still open, or null. */
		blockedReason: string | null;
		familySummary: { streams: number; columns: number };
		/** Every instrument the plan binds, minted at registration or created by the apply. */
		instruments: InstrumentBinding[];
		/** What the apply will create, as rows: a count says how many, only these say which. */
		created: Creations;
		/** Rename or describe a category the apply has not created yet. */
		ongroupattribute: (
			group: GroupCreation,
			field: 'label' | 'description',
			value: string,
		) => void;
		/** Correct one attribute of a site the apply has not created yet. */
		onsiteattribute: (
			site: SiteCreation,
			field: 'latitude' | 'longitude' | 'altitudeM',
			value: number | null,
		) => void;
		applying: boolean;
		/** The tracked job the apply runs as, once it has one. */
		applyJobId: string | null;
		onback: () => void;
		onapply: () => void;
	} = $props();

	// The portals carry an elevation per station and nothing else, so a site created from one is
	// placed here or not at all until somebody edits it site by site.
	const unplacedSites = $derived(sitesWithoutCoordinates(created.sites));
</script>

{#snippet countCard(label: string, count: number, rows: string[])}
	<div class="p-3 bg-brand-bg rounded">
		<span class="text-brand-muted block text-xs">{label}</span>
		{#if rows.length > 0}
			<details>
				<summary class="cursor-pointer list-none">
					<span class="text-lg font-semibold text-brand-primary">{count}</span>
					<span class="text-[11px] text-brand-muted ml-1">which?</span>
				</summary>
				<ul class="mt-1 space-y-0.5 text-xs list-none p-0 max-h-40 overflow-y-auto">
					{#each rows as row (row)}
						<li class="text-brand-muted">{row}</li>
					{/each}
				</ul>
			</details>
		{:else}
			<span class="text-lg font-semibold">{count}</span>
		{/if}
	</div>
{/snippet}

{#snippet groupField(group: GroupCreation, field: 'label' | 'description', value: string)}
	<td class="py-1 pr-2">
		<input
			class="w-full rounded border border-brand-divider bg-brand-surface px-1 py-0.5 text-xs"
			aria-label="{field === 'label' ? 'Name' : 'Description'} for {group.label}"
			{value}
			onchange={(e) => ongroupattribute(group, field, (e.currentTarget as HTMLInputElement).value)}
		/>
	</td>
{/snippet}

{#snippet coordinate(site: SiteCreation, field: 'latitude' | 'longitude' | 'altitudeM', value: number | null)}
	<td class="py-1 pr-2">
		<input
			type="number"
			step="any"
			class="w-24 rounded border border-brand-divider bg-brand-surface px-1 py-0.5 text-xs"
			aria-label="{field === 'altitudeM' ? 'Elevation' : field} for {site.name}"
			{value}
			onchange={(e) => {
				const raw = (e.currentTarget as HTMLInputElement).value.trim();
				onsiteattribute(site, field, raw === '' ? null : Number(raw));
			}}
		/>
	</td>
{/snippet}

<div class="space-y-4 max-w-xl mx-auto">
	<div class="flex items-center gap-3">
		<Button variant="ghost" size="sm" onclick={() => onback()} class="text-brand-primary">&larr; Back to review</Button>
		<h2 class="text-xl font-semibold">Confirm Plan</h2>
	</div>

	<div class="rounded-md border border-brand-divider bg-brand-surface p-6 space-y-4">
		<p class="text-sm">Applying this plan will:</p>
		<div class="grid grid-cols-2 gap-3 text-sm">
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Pair streams</span><span class="text-lg font-semibold text-severity-ok">{formatCount(summary.toPair)}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Skip streams</span><span class="text-lg font-semibold">{formatCount(summary.toSkip)}</span></div>
			{@render countCard('Create projects', summary.newProjects, created.projects)}
			{@render countCard('Create sites', summary.newSites, created.sites.map((s) => s.name))}
			{@render countCard(
				'Create parameters',
				summary.newParams,
				created.parameters.map((p) => (p.units ? `${p.name} (${p.units})` : p.name)),
			)}
			{#if created.groups.length > 0}
				{@render countCard(
					'Create parameter groups',
					created.groups.length,
					created.groups.map(
						(g) => `${g.label} · ${g.members.length} parameter${g.members.length === 1 ? '' : 's'}`,
					),
				)}
			{/if}
			{#if instruments.length > 0}
				<div class="p-3 bg-brand-bg rounded" title="Each instrument is attached to its feeds and deployed at its site, one deployment per parameter it serves">
					<span class="text-brand-muted block text-xs">Instruments</span>
					<details>
						<summary class="cursor-pointer list-none">
							<span class="text-lg font-semibold text-brand-primary">{formatCount(instruments.length)}</span>
							<span class="text-[11px] text-brand-muted ml-1">which?</span>
						</summary>
						<ul class="mt-1 space-y-0.5 text-xs list-none p-0 max-h-40 overflow-y-auto">
							{#each instruments as i (i.name)}
								<li class="text-brand-muted">
									{i.name}
									<span class="opacity-75">
										&middot; {i.parameters.join(', ')} at {i.siteCount} site{i.siteCount === 1 ? '' : 's'}
									</span>
									{#if i.create}<span class="text-brand-primary">&middot; created by this apply</span>{/if}
									{#if i.defaulted}<span class="text-brand-primary">&middot; named for its feed, not a device</span>{/if}
								</li>
							{/each}
						</ul>
					</details>
				</div>
			{/if}
			{#if summary.warnings > 0}
				<div class="p-3 bg-severity-warning-soft rounded"><span class="text-severity-warning block text-xs">Warnings</span><span class="text-lg font-semibold text-severity-warning">{summary.warnings}</span></div>
			{/if}
		</div>

		{#if created.sites.length > 0}
			<details class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs" open={unplacedSites.length > 0}>
				<summary class="cursor-pointer text-brand-primary">
					Check the {created.sites.length === 1 ? 'site' : `${created.sites.length} sites`} before they are created
				</summary>
				{#if unplacedSites.length > 0}
					<p class="mt-2 rounded bg-severity-warning-soft p-2 text-severity-warning">
						{unplacedSites.length} of the {created.sites.length} sites would be created with no
						coordinates: {unplacedSites.map((s) => s.name).join(', ')}. The source carries none, so a
						site left blank is absent from the map and cannot be ranked against a weather station by
						distance. Fill them in below, or edit each site afterwards one at a time.
					</p>
				{/if}
				<p class="text-brand-muted mt-2">
					A site is created once, and everything measured there inherits where it is. A value the
					source recorded wrong is corrected here; leaving a field blank creates the site without it.
				</p>
				<table class="w-full mt-2">
					<thead><tr class="text-brand-muted text-left">
						<th class="py-1 pr-2 font-semibold">Site</th>
						<th class="py-1 pr-2 font-semibold">Latitude</th>
						<th class="py-1 pr-2 font-semibold">Longitude</th>
						<th class="py-1 pr-2 font-semibold">Elevation (m)</th>
						<th class="py-1 font-semibold">Feeds</th>
					</tr></thead>
					<tbody>
						{#each created.sites as site (site.name)}
							<tr class="border-t border-brand-divider">
								<td class="py-1 pr-2">{site.name}</td>
								{@render coordinate(site, 'latitude', site.latitude)}
								{@render coordinate(site, 'longitude', site.longitude)}
								{@render coordinate(site, 'altitudeM', site.altitudeM)}
								<td class="py-1 text-brand-muted">{site.streamCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</details>
		{/if}

		<!-- The source's own categories. A group is created once and every column of its category
		     is placed in it, at the position the registry gives. -->
		{#if created.groups.length > 0}
			<details class="rounded-md border border-brand-divider bg-brand-bg p-3 text-xs">
				<summary class="cursor-pointer text-brand-primary">
					Name the {created.groups.length === 1 ? 'category' : `${created.groups.length} categories`} before they are created
				</summary>
				<p class="text-brand-muted mt-2">
					A category is created once and every column it holds is placed in it. The name is the
					source's own; renaming it here renames it for every column, and a name the database
					already carries joins that group instead of creating a second one.
				</p>
				<table class="w-full mt-2">
					<thead><tr class="text-brand-muted text-left">
						<th class="py-1 pr-2 font-semibold">Name</th>
						<th class="py-1 pr-2 font-semibold">Description</th>
						<th class="py-1 font-semibold">Parameters</th>
					</tr></thead>
					<tbody>
						{#each created.groups as group (group.code)}
							<tr class="border-t border-brand-divider">
								{@render groupField(group, 'label', group.label)}
								{@render groupField(group, 'description', group.description ?? '')}
								<td class="py-1 text-brand-muted" title={group.members.join(', ')}>{group.members.length}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</details>
		{/if}

		{#if familySummary.streams > 0}
			<p class="text-xs text-brand-muted">
				{familySummary.streams} of these streams are replicate families ({familySummary.columns}
				readings columns collapse into them); the source's statistics are audited, not stored.
			</p>
		{/if}
		<p class="text-xs text-brand-muted">Readings will be backfilled with site and parameter IDs. Continuous aggregates will refresh in the background. Reverting unpairs the streams and takes the site and parameter back off their readings; sites, slots, parameters, parameter groups, instruments and deployments the apply creates stay, and a reverted plan cannot be applied again.</p>

		{#if applying && applyJobId}
			<p class="text-xs text-brand-muted">
				Running as job <span class="font-mono">{applyJobId.slice(0, 8)}</span>, which carries on if
				you leave this page: follow it on
				<a href="{base}/system?tab=jobs" class="text-brand-primary no-underline hover:underline">System → Jobs</a>.
			</p>
		{/if}

		<div class="flex gap-3 pt-2">
			<Button onclick={() => onback()} class="px-4 py-2">Back to Review</Button>
			<Button
				variant="primary"
				onclick={onapply}
				disabled={applying || blockedReason !== null}
				title={blockedReason ?? undefined}
				class="px-4 py-2 font-semibold"
			>
				{applying ? 'Applying…' : 'Apply Plan'}
			</Button>
		</div>
	</div>
</div>
