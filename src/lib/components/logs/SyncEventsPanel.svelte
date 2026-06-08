<script lang="ts">
	import { crudClient } from '$api/crud';
	import type { SyncEvent } from '$api/service';
	import CrudList from '$components/crud/CrudList.svelte';

	// sync_events is a CrudCrate entity too (read_metadata); reuse the generic list for filtering.
	const syncEventsClient = crudClient<SyncEvent>('sync_events');

	const syncColumns = [
		{ key: 'started_at', label: 'Started', sortable: true },
		{ key: 'event_type', label: 'Type', sortable: false },
		{ key: 'status', label: 'Status', sortable: true },
		{ key: 'readings_synced', label: 'Readings', sortable: false },
		{ key: 'duration_ms', label: 'Duration (ms)', sortable: true },
	];
</script>

<CrudList
	client={syncEventsClient}
	columns={syncColumns}
	title="Sync events"
	perPage={50}
	defaultSort={['started_at', 'DESC']}
/>
