<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { base } from '$app/paths';
	import { issueSyncCommand, createServiceCredential, revokeSyncService, type SyncService, type SyncCommand, type SyncEvent, type SyncServiceCredential } from '$api/service';
	import { getList } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';

	let activeTab = $state(0);
	let services = $state<SyncService[]>([]);
	let commands = $state<SyncCommand[]>([]);
	let events = $state<SyncEvent[]>([]);
	let credentials = $state<SyncServiceCredential[]>([]);
	let loading = $state(true);
	let pollInterval: ReturnType<typeof setInterval>;

	let expanded = $state<Record<string, boolean>>({});
	let credentialDialog = $state(false);
	let newCredential = $state<{ client_id: string; client_secret: string } | null>(null);
	let eventDetailDialog = $state(false);
	let selectedEvent = $state<SyncEvent | null>(null);

	let createDialog = $state(false);
	let createServiceType = $state('');

	async function loadData() {
		try {
			const [svc, cmd, evt, cred] = await Promise.all([
				getList<SyncService>('/api/sync_services', { perPage: 50 }),
				getList<SyncCommand>('/api/sync_commands', { perPage: 100, sort: ['created_at', 'DESC'] }),
				getList<SyncEvent>('/api/sync_events', { perPage: 100, sort: ['started_at', 'DESC'] }),
				getList<SyncServiceCredential>('/api/sync_service_credentials', { perPage: 50 }),
			]);
			services = svc.data;
			commands = cmd.data;
			events = evt.data as SyncEvent[];
			credentials = cred.data as SyncServiceCredential[];
		} finally { loading = false; }
	}

	const knownServiceTypes = $derived(
		Array.from(new Set([
			...services.map((s) => s.service_type),
			...credentials.map((c) => c.service_type),
		].filter(Boolean))).sort(),
	);

	const pendingCredentials = $derived(credentials.filter((c) => !c.service_id));

	function credentialsForService(serviceId: string) {
		return credentials.filter((c) => c.service_id === serviceId);
	}
	function commandsForService(serviceId: string) {
		return commands.filter((c) => c.service_id === serviceId).slice(0, 10);
	}
	function eventsForService(serviceId: string) {
		return events.filter((e) => e.service_id === serviceId).slice(0, 10);
	}

	function serviceHealth(svc: SyncService): 'ok' | 'warning' | 'alarm' | 'unknown' {
		if (!svc.last_heartbeat) return 'unknown';
		const age = Date.now() - new Date(svc.last_heartbeat).getTime();
		if (age < 90_000) return 'ok';
		if (age < 300_000) return 'warning';
		return 'alarm';
	}

	async function sendCommand(serviceId: string, command: string) {
		try {
			await issueSyncCommand(serviceId, command);
			toastStore.success(`Command "${command}" sent`);
			loadData();
		} catch { toastStore.error('Failed to send command'); }
	}

	function openCreateDialog(serviceType = '') {
		createServiceType = serviceType;
		createDialog = true;
	}

	async function handleCreateCredential() {
		const serviceType = createServiceType.trim();
		if (!serviceType) { toastStore.error('Enter a service type'); return; }
		try {
			newCredential = await createServiceCredential(serviceType);
			createDialog = false;
			credentialDialog = true;
			loadData();
		} catch { toastStore.error('Failed to create credential'); }
	}

	async function handleRevoke(credId: string) {
		try {
			await revokeSyncService(credId);
			toastStore.success('Credential revoked');
			loadData();
		} catch { toastStore.error('Failed to revoke'); }
	}

	onMount(() => { loadData(); pollInterval = setInterval(loadData, 10_000); });
	onDestroy(() => clearInterval(pollInterval));
</script>

<svelte:head><title>System | River Data</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">System</h2>
	<Tabs tabs={['Services', 'API Tokens']} bind:active={activeTab} />

	{#if loading}
		<p class="text-brand-muted">Loading...</p>
	{:else if activeTab === 0}
		<div class="flex justify-end">
			<button onclick={() => openCreateDialog()} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none">New service credential</button>
		</div>

		<div class="space-y-3">
			{#each services as svc}
				{@const health = serviceHealth(svc)}
				{@const svcCreds = credentialsForService(svc.id)}
				{@const svcCommands = commandsForService(svc.id)}
				{@const svcEvents = eventsForService(svc.id)}
				{@const open = expanded[svc.id] ?? false}
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<button
						onclick={() => (expanded[svc.id] = !open)}
						class="w-full flex items-center gap-2 px-4 py-3 cursor-pointer bg-transparent border-none text-left"
					>
						<span class="text-brand-muted text-xs w-3">{open ? '▾' : '▸'}</span>
						<span class="w-2.5 h-2.5 rounded-full {health === 'ok' ? 'bg-severity-ok' : health === 'warning' ? 'bg-severity-warning' : health === 'alarm' ? 'bg-severity-alarm' : 'bg-severity-unknown'}"></span>
						<span class="font-semibold text-sm">{svc.instance_id}</span>
						<span class="text-xs text-brand-muted">{svc.service_type}</span>
						<span class="text-xs text-brand-muted ml-auto">{svc.last_heartbeat ? formatRelativeTime(svc.last_heartbeat) : 'Never'}</span>
					</button>

					{#if open}
						<div class="px-4 pb-4 space-y-4 border-t border-brand-divider pt-3">
							<div class="text-xs text-brand-muted space-y-1">
								<div>Status: {svc.status} {svc.current_operation ? `(${svc.current_operation})` : ''}</div>
								<div>Last sync: {svc.last_sync_completed_at ? formatRelativeTime(svc.last_sync_completed_at) : 'Never'}</div>
								{#if svc.last_error}
									<div class="text-severity-alarm">Error: {svc.last_error}</div>
								{/if}
							</div>
							<div class="flex gap-2">
								<button onclick={() => sendCommand(svc.id, 'trigger_sync')} class="px-2 py-1 text-xs bg-brand-primary text-white rounded cursor-pointer border-none">Sync</button>
								<ConfirmPopover message="Trigger a full sync (re-fetch all data)?" confirmLabel="Full Sync" confirmVariant="primary" onconfirm={() => sendCommand(svc.id, 'trigger_full_sync')}>
									<button class="px-2 py-1 text-xs border border-brand-divider rounded cursor-pointer bg-brand-surface">Full Sync</button>
								</ConfirmPopover>
							</div>

							<div>
								<div class="flex items-center justify-between mb-1">
									<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted">Credentials</h4>
									<button onclick={() => openCreateDialog(svc.service_type)} class="text-xs text-brand-primary bg-transparent border-none cursor-pointer hover:underline">+ New credential</button>
								</div>
								{#if svcCreds.length === 0}
									<p class="text-xs text-brand-muted">No credentials linked to this service</p>
								{:else}
									<ul class="space-y-1">
										{#each svcCreds as cred}
											<li class="flex items-center gap-2 text-xs">
												<span class="font-mono">{cred.client_id}</span>
												{#if cred.revoked}<span class="text-severity-alarm">Revoked</span>{:else}<span class="text-severity-ok">Active</span>{/if}
												{#if !cred.revoked}
													<ConfirmPopover message="Revoke this credential?" confirmLabel="Revoke" onconfirm={() => handleRevoke(cred.id)}>
														<button class="text-severity-alarm bg-transparent border-none cursor-pointer hover:underline ml-auto">Revoke</button>
													</ConfirmPopover>
												{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</div>

							<div>
								<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted mb-1">Recent commands</h4>
								{#if svcCommands.length === 0}
									<p class="text-xs text-brand-muted">No commands</p>
								{:else}
									<table class="w-full text-xs">
										<tbody>
											{#each svcCommands as cmd}
												<tr class="border-b border-brand-divider last:border-b-0">
													<td class="py-1 font-mono">{cmd.command}</td>
													<td class="py-1"><span class="px-2 py-0.5 rounded-full {cmd.status === 'completed' ? 'bg-severity-ok-soft text-severity-ok' : cmd.status === 'failed' ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted'}">{cmd.status}</span></td>
													<td class="py-1 text-brand-muted">{formatRelativeTime(cmd.created_at)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</div>

							<div>
								<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted mb-1">Recent events</h4>
								{#if svcEvents.length === 0}
									<p class="text-xs text-brand-muted">No events</p>
								{:else}
									<table class="w-full text-xs">
										<tbody>
											{#each svcEvents as evt}
												<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer" onclick={() => { selectedEvent = evt; eventDetailDialog = true; }}>
													<td class="py-1">{evt.event_type}</td>
													<td class="py-1"><span class="px-2 py-0.5 rounded-full {evt.status === 'completed' ? 'bg-severity-ok-soft text-severity-ok' : evt.status === 'failed' ? 'bg-severity-alarm-soft text-severity-alarm' : 'bg-brand-bg text-brand-muted'}">{evt.status}</span></td>
													<td class="py-1">{evt.readings_synced} readings</td>
													<td class="py-1">{evt.status_events_synced} status events</td>
													<td class="py-1 text-brand-muted">{formatRelativeTime(evt.started_at)}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/each}
			{#if services.length === 0}
				<p class="text-sm text-brand-muted">No sync services registered</p>
			{/if}
		</div>

		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-3 border-b border-brand-divider">
				<h3 class="text-sm font-semibold">Pending credentials</h3>
				<p class="text-xs text-brand-muted">Issued but not yet enrolled by a running service</p>
			</div>
			{#if pendingCredentials.length === 0}
				<p class="px-4 py-4 text-sm text-brand-muted">No pending credentials</p>
			{:else}
				<table class="w-full text-sm">
					<thead><tr class="bg-brand-bg border-b border-brand-divider">
						<th class="text-left px-4 py-2 font-semibold">Client ID</th>
						<th class="text-left px-4 py-2 font-semibold">Type</th>
						<th class="text-left px-4 py-2 font-semibold">Status</th>
						<th class="text-left px-4 py-2 font-semibold">Created</th>
						<th class="text-left px-4 py-2 font-semibold">Actions</th>
					</tr></thead>
					<tbody>
						{#each pendingCredentials as cred}
							<tr class="border-b border-brand-divider last:border-b-0">
								<td class="px-4 py-2 font-mono text-xs">{cred.client_id}</td>
								<td class="px-4 py-2 text-xs">{cred.service_type}</td>
								<td class="px-4 py-2">{#if cred.revoked}<span class="text-xs text-severity-alarm">Revoked</span>{:else}<span class="text-xs text-severity-ok">Active</span>{/if}</td>
								<td class="px-4 py-2 text-xs text-brand-muted">{formatRelativeTime(cred.created_at)}</td>
								<td class="px-4 py-2">
									{#if !cred.revoked}
										<ConfirmPopover message="Revoke this credential?" confirmLabel="Revoke" onconfirm={() => handleRevoke(cred.id)}>
											<button class="text-xs text-severity-alarm bg-transparent border-none cursor-pointer hover:underline">Revoke</button>
										</ConfirmPopover>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

	{:else if activeTab === 1}
		<div class="text-sm text-brand-muted">
			<a href="{base}/tokens" class="text-brand-primary no-underline hover:underline">Manage API Tokens &rarr;</a>
		</div>
	{/if}
</div>

<!-- Event Detail Dialog -->
<Dialog bind:open={eventDetailDialog} title="Sync Event Detail" maxWidth="md">
	{#snippet children()}
		{#if selectedEvent}
			<div class="space-y-3 text-sm">
				<div class="grid grid-cols-2 gap-3">
					<div><span class="text-brand-muted">Type</span><p>{selectedEvent.event_type}</p></div>
					<div><span class="text-brand-muted">Status</span><p>{selectedEvent.status}</p></div>
					<div><span class="text-brand-muted">Readings synced</span><p>{selectedEvent.readings_synced}</p></div>
					<div><span class="text-brand-muted">Status events synced</span><p>{selectedEvent.status_events_synced}</p></div>
					<div><span class="text-brand-muted">Started</span><p>{formatDateTime(selectedEvent.started_at)}</p></div>
					<div><span class="text-brand-muted">Duration</span><p>{selectedEvent.duration_ms != null ? `${(selectedEvent.duration_ms / 1000).toFixed(1)}s` : '—'}</p></div>
				</div>
				{#if selectedEvent.errors?.length}
					<div><span class="text-brand-muted block mb-1">Errors</span><pre class="bg-severity-alarm-soft p-2 rounded text-xs whitespace-pre-wrap">{selectedEvent.errors.join('\n')}</pre></div>
				{/if}
				{#if selectedEvent.log?.length}
					<div><span class="text-brand-muted block mb-1">Log</span><pre class="bg-brand-bg p-2 rounded text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">{selectedEvent.log.join('\n')}</pre></div>
				{/if}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<button onclick={() => eventDetailDialog = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Close</button>
	{/snippet}
</Dialog>

<!-- New Credential Dialog -->
<Dialog bind:open={createDialog} title="New service credential" maxWidth="sm">
	{#snippet children()}
		<div class="space-y-3">
			<label class="block text-sm">
				<span class="text-brand-muted">Service type</span>
				<input
					bind:value={createServiceType}
					list="service-type-options"
					placeholder="e.g. vaisala"
					class="mt-1 w-full px-3 py-2 border border-brand-divider rounded-md text-sm bg-brand-surface"
				/>
				<datalist id="service-type-options">
					{#each knownServiceTypes as t}
						<option value={t}></option>
					{/each}
				</datalist>
			</label>
			<p class="text-xs text-brand-muted">Type a new service type or pick an existing one.</p>
		</div>
	{/snippet}
	{#snippet actions()}
		<button onclick={() => createDialog = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Cancel</button>
		<button onclick={handleCreateCredential} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none">Create</button>
	{/snippet}
</Dialog>

<!-- Credential Created Dialog -->
<Dialog bind:open={credentialDialog} title="Credential Created" maxWidth="sm">
	{#snippet children()}
		{#if newCredential}
			<div class="space-y-3">
				<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">Copy the secret now. It will not be shown again.</div>
				<div><span class="text-sm text-brand-muted">Client ID</span><p class="font-mono text-sm bg-brand-bg p-2 rounded">{newCredential.client_id}</p></div>
				<div><span class="text-sm text-brand-muted">Client Secret</span><p class="font-mono text-sm bg-brand-bg p-2 rounded select-all break-all">{newCredential.client_secret}</p></div>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<button onclick={() => { if (newCredential) navigator.clipboard.writeText(newCredential.client_secret); toastStore.success('Copied'); }} class="px-3 py-1.5 bg-brand-primary text-white rounded-md text-sm cursor-pointer border-none">Copy Secret</button>
		<button onclick={() => credentialDialog = false} class="px-3 py-1.5 border border-brand-divider rounded-md text-sm cursor-pointer bg-brand-surface">Done</button>
	{/snippet}
</Dialog>
