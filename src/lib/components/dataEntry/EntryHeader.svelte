<script lang="ts">
	import { stageCollectionEvent } from '$api/service';
	import { newEntryRequest } from '$lib/dataEntry/entry';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { siteRefs } from '$lib/siteRefs.svelte';
	import { apiMessage } from '$lib/standardCurves';
	import Button from '$components/ui/Button.svelte';
	import TimestampInput from '$components/ui/TimestampInput.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';

	// Station, date and New entry, as the portal's tools tab opens: the visit every form below
	// computes at and saves into.
	let siteId = $state(stagedVisit.current?.siteId ?? '');
	let collectedAt = $state('');
	let staging = $state(false);

	async function newEntry() {
		const made = newEntryRequest(siteId, collectedAt);
		if ('error' in made) {
			toastStore.error(made.error);
			return;
		}
		staging = true;
		try {
			const visit = await stageCollectionEvent(made.request);
			await siteRefs.ensure();
			stagedVisit.set({
				eventId: visit.id,
				siteId: visit.site_id,
				siteName: siteRefs.name(visit.site_id),
				collectedAt: visit.collected_at,
			});
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			staging = false;
		}
	}
</script>

<div class="flex flex-wrap items-end gap-3 rounded-md border border-brand-divider bg-brand-surface p-3">
	<label class="text-xs text-brand-muted">
		Station
		<SiteSelect bind:value={siteId} ariaLabel="Station" class="block mt-0.5 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text" />
	</label>
	<label class="text-xs text-brand-muted">
		Date
		<TimestampInput bind:value={collectedAt} ariaLabel="Date" class="mt-0.5" />
	</label>
	<Button variant="primary" size="sm" onclick={newEntry} disabled={staging}>
		{staging ? 'Opening…' : 'New entry'}
	</Button>
</div>
