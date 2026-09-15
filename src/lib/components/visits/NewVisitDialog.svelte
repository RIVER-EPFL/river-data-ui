<script lang="ts">
	import { base } from '$app/paths';
	import { stageCollectionEvent, type StagedEvent } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, toDatetimeLocal, fromDatetimeLocal } from '$lib/utils';
	import { siteRefs } from '$lib/siteRefs.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';

	// Adding a visit to the Visits table: a site and a date, and the row is there. A field day
	// covering several stations is several adds in a row, so the dialog stays open and lists what
	// it has added. A visit that already stands at that (site, instant) is joined, not duplicated.

	const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

	let {
		open = $bindable(false),
		siteId = null,
		onadded = null,
	}: {
		open: boolean;
		/// The site the table is filtered to, fixed for every visit added here. Null offers a picker.
		siteId?: string | null;
		/// A visit was created or joined; the table behind the dialog re-reads itself.
		onadded?: ((event: StagedEvent) => void) | null;
	} = $props();

	let chosenSite = $state('');
	let when = $state(toDatetimeLocal(Date.now(), BROWSER_ZONE));
	let notes = $state('');
	let adding = $state(false);
	let added = $state<StagedEvent[]>([]);

	const site = $derived(siteId ?? chosenSite);

	$effect(() => {
		if (!open) return;
		added = [];
		notes = '';
		if (!siteId) void siteRefs.ensure().catch(() => {});
	});

	async function add() {
		if (!site || !when) {
			toastStore.error('Choose a site and a collection time');
			return;
		}
		adding = true;
		try {
			const event = await stageCollectionEvent({
				site_id: site,
				collected_at: fromDatetimeLocal(when, BROWSER_ZONE),
				...(notes.trim() ? { notes: notes.trim() } : {}),
			});
			added = [...added, event];
			notes = '';
			toastStore.success(event.created ? 'Visit added' : 'That visit already stands; opened it');
			onadded?.(event);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Could not add the visit');
		} finally {
			adding = false;
		}
	}
</script>

<Dialog bind:open title="New visit" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				{#if !siteId}
					<div class="flex flex-col gap-1">
						<label for="nv-site" class="text-sm font-medium">
							Site <span class="text-severity-alarm">*</span>
						</label>
						<SiteSelect id="nv-site" bind:value={chosenSite} />
					</div>
				{/if}
				<div class="flex flex-col gap-1">
					<label for="nv-time" class="text-sm font-medium">
						Date and time <span class="text-severity-alarm">*</span>
					</label>
					<input
						id="nv-time"
						type="datetime-local"
						bind:value={when}
						class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
					/>
					<span class="text-xs text-brand-muted">{BROWSER_ZONE}</span>
				</div>
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
			<p class="text-xs text-brand-muted">
				Add covers a field day one station at a time: change the site or the time and add again.
			</p>

			{#if added.length > 0}
				<div class="space-y-1">
					<p class="text-xs font-semibold">Added</p>
					<ul class="divide-y divide-brand-divider border border-brand-divider rounded-md">
						{#each added as event (event.id)}
							<li class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
								<span>{siteRefs.name(event.site_id)} · {formatDateTime(event.collected_at)}</span>
								<a class="text-brand-primary hover:underline" href="{base}/visits/{event.id}">
									Open the grid
								</a>
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
		<Button variant="primary" loading={adding} disabled={!site} onclick={add}>
			{adding ? 'Adding…' : 'Add visit'}
		</Button>
	{/snippet}
</Dialog>
