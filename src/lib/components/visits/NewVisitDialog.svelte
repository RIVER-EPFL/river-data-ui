<script lang="ts">
	import { base } from '$app/paths';
	import { stageCollectionEvents, type StagedEvent } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { siteRefs } from '$lib/siteRefs.svelte';
	import { nextRow, repeatedRows, type FieldDayRow } from '$lib/visits/fieldDay';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';

	// A field day on the Visits table: one row per visit, each a site and the time it was sampled,
	// saved together. Several sites on one day is normal; one site twice at one time is refused. A
	// visit that already stands at that (site, instant) is joined, not duplicated.

	const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const ZONES = [
		{ value: BROWSER_ZONE, label: BROWSER_ZONE },
		{ value: 'UTC', label: 'UTC' },
		{ value: 'Etc/GMT-1', label: 'UTC+01:00' },
		{ value: 'Etc/GMT-2', label: 'UTC+02:00' },
	];

	let {
		open = $bindable(false),
		siteId = null,
		onadded = null,
	}: {
		open: boolean;
		/// The site the table is filtered to, fixed for every row. Null offers a picker per row.
		siteId?: string | null;
		/// A visit was created or joined; the table behind the dialog re-reads itself.
		onadded?: ((event: StagedEvent) => void) | null;
	} = $props();

	let rows = $state<FieldDayRow[]>([]);
	let zone = $state(BROWSER_ZONE);
	let notes = $state('');
	let saving = $state(false);
	let added = $state<StagedEvent[]>([]);

	const repeats = $derived(repeatedRows(rows));
	const ready = $derived(rows.length > 0 && rows.every((r) => r.site && r.when) && repeats.length === 0);

	$effect(() => {
		if (!open) return;
		rows = [{ site: siteId ?? '', when: toDatetimeLocal(Date.now(), BROWSER_ZONE) }];
		added = [];
		notes = '';
		if (!siteId) void siteRefs.ensure().catch(() => {});
	});

	function addRow() {
		rows = [...rows, nextRow(rows[rows.length - 1], siteId)];
	}

	function removeRow(index: number) {
		rows = rows.filter((_, i) => i !== index);
	}

	async function save() {
		if (!ready) return;
		saving = true;
		try {
			const staged = await stageCollectionEvents({
				visits: rows.map((r) => ({ site_id: r.site, collected_at: fromDatetimeLocal(r.when, zone) })),
				...(notes.trim() ? { notes: notes.trim() } : {}),
			});
			added = staged;
			const created = staged.filter((e) => e.created).length;
			toastStore.success(
				created === staged.length
					? `${created} visit${created === 1 ? '' : 's'} added`
					: `${created} added, ${staged.length - created} already stood`,
			);
			for (const event of staged) onadded?.(event);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not add the visits');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open title="New entry" maxWidth="md">
	{#snippet children()}
		<div class="space-y-3">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-xs text-brand-muted">
						{#if !siteId}<th class="font-medium pb-1">Site</th>{/if}
						<th class="font-medium pb-1">Date and time</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, index (index)}
						{@const repeat = repeats.find(([, r]) => r === index)}
						<tr>
							{#if !siteId}
								<td class="pr-2 py-1">
									<SiteSelect id="nv-site-{index}" bind:value={row.site} />
								</td>
							{/if}
							<td class="pr-2 py-1">
								<input
									aria-label="Date and time, row {index + 1}"
									type="datetime-local"
									bind:value={row.when}
									class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
								/>
								{#if repeat}
									<span class="block text-xs text-severity-alarm">Same site and time as row {repeat[0] + 1}</span>
								{/if}
							</td>
							<td class="py-1 text-right">
								{#if rows.length > 1}
									<Button size="sm" variant="ghost" onclick={() => removeRow(index)}>Remove</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Button size="sm" variant="secondary" onclick={addRow}>Add another</Button>
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1">
					<label for="nv-zone" class="text-sm font-medium">Time zone</label>
					<select
						id="nv-zone"
						bind:value={zone}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					>
						{#each ZONES as z (z.value)}
							<option value={z.value}>{z.label}</option>
						{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1">
					<label for="nv-notes" class="text-sm font-medium">
						Notes <span class="text-brand-muted font-normal">(optional)</span>
					</label>
					<input
						id="nv-notes"
						bind:value={notes}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					/>
				</div>
			</div>

			{#if added.length > 0}
				<div class="space-y-1">
					<p class="text-xs font-semibold">Added</p>
					<ul class="divide-y divide-brand-divider border border-brand-divider rounded-md">
						{#each added as event (event.id)}
							<li class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
								<span>{siteRefs.name(event.site_id)} · {formatDateTime(event.collected_at)}</span>
								<a
									class="text-brand-primary hover:underline"
									href="{base}/sites/{event.site_id}?tab=visits&event={event.id}"
								>Open the visit</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button variant="secondary" onclick={() => (open = false)}>
			{added.length > 0 ? 'Done' : 'Cancel'}
		</Button>
		<Button variant="primary" loading={saving} disabled={!ready} onclick={save}>
			{saving ? 'Saving…' : rows.length === 1 ? 'Add visit' : `Add ${rows.length} visits`}
		</Button>
	{/snippet}
</Dialog>
