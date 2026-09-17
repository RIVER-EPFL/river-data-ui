<script lang="ts">
	import { page } from '$app/state';
	import { api } from '$api/crud';
	import { getList } from '$api/client';
	import {
		createServiceCredential,
		getSyncCommand,
		issueSyncCommand,
		revokeSyncService,
		setFullReassert,
		setSyncInterval,
		type SourceAuditReport,
		type SyncCommand,
		type SyncEvent,
		type SyncService,
		type SyncServiceCredential,
	} from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import SourceAuditPanel from '$components/sync/SourceAuditPanel.svelte';
	import { serviceHealth } from '$lib/sync/health';
	import { FULL_SYNC_CONFIRMATION, resyncConfirmation, servicesForSource } from '$lib/sync/resync';
	import { latestSourceAudit } from '$lib/sync/sourceAudit';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, formatInterval, formatRelativeTime, statusBadgeClass } from '$lib/utils';

	const requestedService = page.url.searchParams.get('service');

	$effect(() => {
		loadStatus();
		const timer = setInterval(loadStatus, 10_000);
		return () => clearInterval(timer);
	});

	// ── Status tab: sync services ───────────────────────────────────────────────
	let services = $state<SyncService[]>([]);
	let commands = $state<SyncCommand[]>([]);
	let events = $state<SyncEvent[]>([]);
	let credentials = $state<SyncServiceCredential[]>([]);
	let statusLoading = $state(true);

	let expanded = $state<Record<string, boolean>>({});
	let credentialDialog = $state(false);
	let newCredential = $state<{ client_id: string; client_secret: string } | null>(null);
	let eventDetailDialog = $state(false);
	let selectedEvent = $state<SyncEvent | null>(null);

	let createDialog = $state(false);
	let createServiceType = $state('');

	async function loadStatus() {
		try {
			const [svc, cmd, evt, cred] = await Promise.all([
				getList<SyncService>('/api/sync_services', { perPage: 50 }),
				getList<SyncCommand>('/api/sync_commands', { perPage: 100, sort: ['created_at', 'DESC'] }),
				getList<SyncEvent>('/api/sync_events', { perPage: 100, sort: ['started_at', 'DESC'] }),
				getList<SyncServiceCredential>('/api/sync_service_credentials', { perPage: 50 }),
			]);
			services = svc.data;
			if (requestedService && statusLoading) {
				for (const s of servicesForSource(svc.data, requestedService)) expanded[s.id] = true;
			}
			commands = cmd.data;
			events = evt.data as SyncEvent[];
			credentials = cred.data as SyncServiceCredential[];
		} finally { statusLoading = false; }
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

	const healthOf = (svc: SyncService) => serviceHealth(svc, eventsForService(svc.id)[0]);

	// The cadence editor holds a per-service draft so a half-typed number never reaches the API.
	let intervalDraft = $state<Record<string, string>>({});
	let intervalSaving = $state<Record<string, boolean>>({});

	function intervalValue(svc: SyncService): string {
		return intervalDraft[svc.id] ?? (svc.sync_interval_secs === null ? '' : String(svc.sync_interval_secs));
	}

	let reassertSaving = $state<Record<string, boolean>>({});

	async function saveFullReassert(svc: SyncService, enabled: boolean) {
		reassertSaving[svc.id] = true;
		try {
			await setFullReassert(svc.id, enabled);
			toastStore.success(
				enabled
					? `${svc.instance_id} joins the weekly full re-assert`
					: `${svc.instance_id} leaves the weekly full re-assert`,
			);
			loadStatus();
		} catch {
			toastStore.error('Failed to set the full re-assert');
		} finally {
			reassertSaving[svc.id] = false;
		}
	}

	async function saveInterval(svc: SyncService) {
		const raw = intervalValue(svc).trim();
		const seconds = raw === '' ? null : Number(raw);
		if (seconds !== null && (!Number.isFinite(seconds) || seconds < 30)) {
			toastStore.error('Cadence must be at least 30 seconds, or blank for the service default');
			return;
		}
		intervalSaving[svc.id] = true;
		try {
			await setSyncInterval(svc.id, seconds);
			delete intervalDraft[svc.id];
			toastStore.success(
				seconds === null ? 'Cadence reset to the service default' : `Cadence set to ${formatInterval(seconds)}`,
			);
			loadStatus();
		} catch {
			toastStore.error('Failed to set the sync cadence');
		} finally {
			intervalSaving[svc.id] = false;
		}
	}

	async function sendCommand(serviceId: string, command: string) {
		try {
			await issueSyncCommand(serviceId, command);
			toastStore.success(`Command "${command}" sent`);
			loadStatus();
		} catch { toastStore.error('Failed to send command'); }
	}

	// resync_streams needs the keys by name, so the service's registered streams are read at the
	// moment of the repair rather than held on the page.
	let resyncing = $state<Record<string, boolean>>({});
	let resyncMessage = $state<Record<string, string>>({});

	async function prepareResync(svc: SyncService) {
		try {
			const r = await api.dataStreams.list({ perPage: 1000, filter: { source_system: svc.service_type } });
			resyncMessage[svc.id] = r.data.length === 0
				? `${svc.instance_id} has no registered streams to repair.`
				: resyncConfirmation(r.data.length, svc.instance_id);
		} catch {
			resyncMessage[svc.id] = `Could not read ${svc.instance_id}'s streams.`;
		}
	}

	async function sendResync(svc: SyncService) {
		resyncing[svc.id] = true;
		try {
			const r = await api.dataStreams.list({ perPage: 1000, filter: { source_system: svc.service_type } });
			const source_keys = r.data.map((d) => d.source_key);
			if (source_keys.length === 0) {
				toastStore.error(`${svc.instance_id} has no registered streams`);
				return;
			}
			await issueSyncCommand(svc.id, 'resync_streams', { source_keys });
			toastStore.success(`Repair queued for ${source_keys.length} streams`);
			loadStatus();
		} catch {
			toastStore.error('Failed to queue the repair');
		} finally {
			resyncing[svc.id] = false;
		}
	}

	// The audit is answered on the service's next heartbeat, so the command is queued and then
	// polled. It writes nothing, so a poll that gives up costs only the report.
	let sourceAuditing = $state<Record<string, boolean>>({});
	let sourceAuditReport = $state<Record<string, SourceAuditReport>>({});
	let sourceAuditError = $state<Record<string, string>>({});

	const AUDIT_POLL_MS = 2000;
	const AUDIT_POLL_ATTEMPTS = 60;

	// What the service last answered with, read from the command rows the page already loads, so a
	// service that is down still shows the source as it was when it was last asked.
	const lastAudit = $derived(
		Object.fromEntries(
			services.map((svc) => [svc.id, latestSourceAudit(commands, svc.id)]),
		) as Record<string, { report: SourceAuditReport; answeredAt: string } | null>,
	);

	async function runSourceAudit(svc: SyncService) {
		sourceAuditing[svc.id] = true;
		delete sourceAuditReport[svc.id];
		delete sourceAuditError[svc.id];
		try {
			const command = await issueSyncCommand(svc.id, 'source_audit');
			for (let attempt = 0; attempt < AUDIT_POLL_ATTEMPTS; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, AUDIT_POLL_MS));
				const current = await getSyncCommand(command.id);
				if (current.status === 'completed') {
					// The command result is whatever the command it answers reports, so the shape is
					// this caller's knowledge rather than the document's.
					sourceAuditReport[svc.id] = current.result as unknown as SourceAuditReport;
					return;
				}
				if (current.status === 'failed' || current.status === 'expired') {
					sourceAuditError[svc.id] = `The audit ${current.status}.`;
					return;
				}
			}
			sourceAuditError[svc.id] = `${svc.instance_id} has not answered yet; it runs on the next heartbeat.`;
		} catch {
			sourceAuditError[svc.id] = 'Could not queue the audit.';
		} finally {
			sourceAuditing[svc.id] = false;
		}
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
			loadStatus();
		} catch { toastStore.error('Failed to create credential'); }
	}

	async function handleRevoke(credId: string) {
		try {
			await revokeSyncService(credId);
			toastStore.success('Credential revoked');
			loadStatus();
		} catch { toastStore.error('Failed to revoke'); }
	}

</script>

<div class="space-y-4">
		{#if statusLoading}
			<p class="text-brand-muted">Loading…</p>
		{:else}
			<div class="flex justify-end">
				<Button variant="primary" onclick={() => openCreateDialog()}>Connect service</Button>
			</div>

			<div class="space-y-3">
				{#each services as svc}
					{@const health = healthOf(svc)}
					{@const svcCreds = credentialsForService(svc.id)}
					{@const svcCommands = commandsForService(svc.id)}
					{@const svcEvents = eventsForService(svc.id)}
					{@const open = expanded[svc.id] ?? false}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<div class="flex items-center gap-2 pr-4">
							<button
								onclick={() => (expanded[svc.id] = !open)}
								class="flex-1 min-w-0 flex items-center gap-2 px-4 py-3 cursor-pointer bg-transparent border-none text-left"
							>
								<span class="text-brand-muted text-xs w-3">{open ? '▾' : '▸'}</span>
								<span class="w-2.5 h-2.5 rounded-full {health === 'ok' ? 'bg-severity-ok-fill' : health === 'warning' ? 'bg-severity-warning-fill' : health === 'alarm' ? 'bg-severity-alarm' : 'bg-severity-unknown'}"></span>
								<span class="font-semibold text-sm">{svc.instance_id}</span>
								<span class="text-xs text-brand-muted">{svc.service_type}</span>
								{#if svc.paused}
									<span class="text-xs px-1.5 py-0.5 rounded bg-severity-warning-fill/15 text-severity-warning">Paused</span>
								{/if}
								<span class="text-xs text-brand-muted">{svc.sync_interval_secs ? formatInterval(svc.sync_interval_secs) : 'service default'}</span>
								<span class="text-xs text-brand-muted ml-auto pl-2">{svc.last_heartbeat ? formatRelativeTime(svc.last_heartbeat) : 'Never'}</span>
							</button>
							<!-- Outside the expander: pausing a runaway sync should not need a click to find. -->
							{#if svc.paused}
								<Button size="sm" onclick={() => sendCommand(svc.id, 'resume')}>Resume</Button>
							{:else}
								<ConfirmPopover message="Pause scheduled syncs? The service keeps its heartbeat and still runs syncs triggered from here." confirmLabel="Pause" confirmVariant="primary" onconfirm={() => sendCommand(svc.id, 'pause')}>
									<Button size="sm">Pause</Button>
								</ConfirmPopover>
							{/if}
						</div>

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
									<Button variant="primary" size="sm" onclick={() => sendCommand(svc.id, 'trigger_sync')}>Sync</Button>
									<ConfirmPopover message={FULL_SYNC_CONFIRMATION} confirmLabel="Full Sync" confirmVariant="primary" onconfirm={() => sendCommand(svc.id, 'trigger_full_sync')}>
										<Button size="sm">Full Sync</Button>
									</ConfirmPopover>
									<ConfirmPopover
										message={resyncMessage[svc.id] ?? `Read ${svc.instance_id}'s streams…`}
										confirmLabel="Repair"
										confirmVariant="alarm"
										onconfirm={() => sendResync(svc)}
									>
										<Button size="sm" disabled={resyncing[svc.id]} onclick={() => prepareResync(svc)}>Repair stored values</Button>
									</ConfirmPopover>
									<Button
										size="sm"
										disabled={sourceAuditing[svc.id]}
										title="The service answers on its next heartbeat; the last report it answered with is shown until then."
										onclick={() => runSourceAudit(svc)}
									>
										{sourceAuditing[svc.id] ? 'Auditing…' : 'Audit against source'}
									</Button>
								</div>
								{#if sourceAuditError[svc.id]}
									<p class="text-xs text-severity-alarm">{sourceAuditError[svc.id]}</p>
								{/if}
								{#if sourceAuditReport[svc.id]}
									<SourceAuditPanel report={sourceAuditReport[svc.id]} />
								{:else if lastAudit[svc.id]}
									<p class="text-xs text-brand-muted">
										Last answered {formatDateTime(lastAudit[svc.id]!.answeredAt)}. A new audit
										runs on the service's next heartbeat.
									</p>
									<SourceAuditPanel report={lastAudit[svc.id]!.report} />
								{/if}
								<div class="flex items-center gap-2 flex-wrap">
									<label class="text-xs text-brand-muted" for="cadence-{svc.id}">Sync every</label>
									<input
										id="cadence-{svc.id}"
										type="number"
										min="30"
										step="30"
										placeholder="service default"
										value={intervalValue(svc)}
										oninput={(e) => (intervalDraft[svc.id] = e.currentTarget.value)}
										class="w-36 px-2 py-1 text-xs rounded border border-brand-divider bg-brand-bg"
									/>
									<span class="text-xs text-brand-muted">seconds</span>
									<Button size="sm" disabled={intervalSaving[svc.id]} onclick={() => saveInterval(svc)}>Save</Button>
									<span class="text-xs text-brand-muted">
										{svc.sync_interval_secs === null
											? 'Running on its own SYNC_INTERVAL_SECONDS; leave blank to keep it there.'
											: `Set to ${formatInterval(svc.sync_interval_secs)}; clear the field to return to the service default.`}
										Adopted on the next heartbeat, no restart.
									</span>
								</div>
								<div class="flex items-center gap-2 flex-wrap">
									<label class="text-xs text-brand-muted" for="reassert-{svc.id}">Weekly full re-assert</label>
									<input
										id="reassert-{svc.id}"
										type="checkbox"
										checked={svc.full_reassert_enabled}
										disabled={reassertSaving[svc.id]}
										onchange={(e) => saveFullReassert(svc, e.currentTarget.checked)}
									/>
									<span class="text-xs text-brand-muted">
										The digest handshake stops a routine pass re-sending unchanged content, so the weekly
										pass is what repairs drift the digests cannot see.
									</span>
								</div>
								{#if svc.paused}
									<p class="text-xs text-brand-muted">Scheduled syncs are paused; the Sync and Full Sync buttons still run a cycle. Pause persists across service restarts.</p>
								{/if}

								<div>
									<div class="flex items-center justify-between mb-1">
										<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted">Credentials</h4>
									<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => openCreateDialog(svc.service_type)}>+ Add credential</Button>
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
															<Button variant="ghost" size="sm" class="text-severity-alarm ml-auto">Revoke</Button>
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
														<td class="py-1"><span class="px-2 py-0.5 rounded-full {statusBadgeClass(cmd.status)}">{cmd.status}</span></td>
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
														<td class="py-1"><span class="px-2 py-0.5 rounded-full {statusBadgeClass(evt.status)}">{evt.status}</span></td>
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
					<h3 class="text-sm font-semibold">Awaiting connection</h3>
					<p class="text-xs text-brand-muted">Issued but not yet enrolled by a running service</p>
				</div>
				{#if pendingCredentials.length === 0}
					<p class="px-4 py-4 text-sm text-brand-muted">No credentials awaiting connection</p>
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
												<Button variant="ghost" size="sm" class="text-severity-alarm">Revoke</Button>
											</ConfirmPopover>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
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
					<div><span class="text-brand-muted">Duration</span><p>{selectedEvent.duration_ms != null ? `${(selectedEvent.duration_ms / 1000).toFixed(1)}s` : 'None'}</p></div>
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
		<Button onclick={() => eventDetailDialog = false}>Close</Button>
	{/snippet}
</Dialog>

<!-- New Credential Dialog -->
<Dialog bind:open={createDialog} title="Connect service" maxWidth="sm">
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
		<Button onclick={() => createDialog = false}>Cancel</Button>
		<Button variant="primary" onclick={handleCreateCredential}>Create credential</Button>
	{/snippet}
</Dialog>

<!-- Credential Created Dialog -->
<Dialog bind:open={credentialDialog} title="Service credential created" maxWidth="sm">
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
		<Button variant="primary" onclick={() => { if (newCredential) navigator.clipboard.writeText(newCredential.client_secret); toastStore.success('Copied'); }}>Copy Secret</Button>
		<Button onclick={() => credentialDialog = false}>Done</Button>
	{/snippet}
</Dialog>
