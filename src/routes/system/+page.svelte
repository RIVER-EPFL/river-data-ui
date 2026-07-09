<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$auth/keycloak.svelte';
	import {
		issueSyncCommand,
		createServiceCredential,
		revokeSyncService,
		listSchedules,
		updateSchedule,
		runScheduleNow,
		getScheduleAudit,
		type SyncService,
		type SyncCommand,
		type SyncEvent,
		type SyncServiceCredential,
		type Schedule,
		type ScheduleUpdate,
		type ScheduleAuditEntry,
		type OverlapPolicy,
		type CatchupPolicy,
	} from '$api/service';
	import { getList, ApiError } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatRelativeTime, formatDateTime, formatInterval } from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import JobsPanel from '$components/logs/JobsPanel.svelte';
	import ApiAuditPanel from '$components/logs/ApiAuditPanel.svelte';
	import SyncEventsPanel from '$components/logs/SyncEventsPanel.svelte';

	// Local-only mode and Administrator role both resolve to 'admin'. The API-audit / sync-events
	// panels and schedule edits need admin; non-admins see a notice rather than failing requests.
	const isAdmin = $derived(auth.role === 'admin');

	// ── Tabs ──────────────────────────────────────────────────────────────────
	const TABS = [
		{ key: 'status', label: 'Status' },
		{ key: 'logs', label: 'Logs' },
		{ key: 'jobs', label: 'Jobs' },
		{ key: 'schedules', label: 'Schedules' },
	];
	const tabLabels = TABS.map((t) => t.label);
	// Legacy /logs tab keys fold into the Logs tab here.
	const TAB_ALIASES: Record<string, string> = { audit: 'logs', sync: 'logs' };

	function resolveActive(): number {
		const raw = page.url.searchParams.get('tab');
		if (!raw) return 0;
		const key = TAB_ALIASES[raw] ?? raw;
		const idx = TABS.findIndex((t) => t.key === key);
		return idx >= 0 ? idx : 0;
	}

	let active = $state(0);
	let initialized = $state(false);
	const activeKey = $derived(TABS[active]?.key ?? 'status');

	onMount(() => {
		active = resolveActive();
		initialized = true;
	});

	// Reflect the active tab back to ?tab (named) for refresh / back / shareable links.
	$effect(() => {
		const key = activeKey;
		if (!initialized) return;
		untrack(() => {
			const url = new URL(page.url);
			if (url.searchParams.get('tab') !== key) {
				url.searchParams.set('tab', key);
				goto(url, { replaceState: true, noScroll: true });
			}
		});
	});

	// Load (and poll) only the data the active tab needs. Jobs / Logs use self-fetching panels.
	$effect(() => {
		if (!initialized) return;
		const key = activeKey;
		if (key === 'status') {
			loadStatus();
			const t = setInterval(loadStatus, 10_000);
			return () => clearInterval(t);
		}
		if (key === 'schedules') {
			loadSchedules();
			const t = setInterval(refreshSchedulesSilently, 10_000);
			return () => clearInterval(t);
		}
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
			loadStatus();
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

	// ── Schedules tab ───────────────────────────────────────────────────────────
	const INTERVAL_UNITS = [
		{ key: 's', label: 'seconds', factor: 1 },
		{ key: 'm', label: 'minutes', factor: 60 },
		{ key: 'h', label: 'hours', factor: 3600 },
		{ key: 'd', label: 'days', factor: 86400 },
	] as const;
	type IntervalUnit = (typeof INTERVAL_UNITS)[number]['key'];

	const OVERLAP_OPTIONS: { value: OverlapPolicy; label: string }[] = [
		{ value: 'skip_if_running', label: 'Skip if running' },
		{ value: 'allow_concurrent', label: 'Allow concurrent' },
	];
	const CATCHUP_OPTIONS: { value: CatchupPolicy; label: string }[] = [
		{ value: 'run_once', label: 'Run once' },
		{ value: 'skip', label: 'Skip' },
	];

	// An editable draft of one schedule. interval is split into amount + unit for the picker;
	// tunables is held as text so the operator can edit JSON freely and we validate on save.
	interface Draft {
		enabled: boolean;
		intervalAmount: number;
		intervalUnit: IntervalUnit;
		overlap_policy: OverlapPolicy;
		catchup_policy: CatchupPolicy;
		tunablesText: string;
	}

	// Pick the largest unit that divides the interval evenly so the picker shows a tidy value.
	function splitInterval(seconds: number): { intervalAmount: number; intervalUnit: IntervalUnit } {
		for (const u of [...INTERVAL_UNITS].reverse()) {
			if (seconds > 0 && seconds % u.factor === 0) {
				return { intervalAmount: seconds / u.factor, intervalUnit: u.key };
			}
		}
		return { intervalAmount: seconds, intervalUnit: 's' };
	}

	function draftFrom(s: Schedule): Draft {
		const { intervalAmount, intervalUnit } = splitInterval(s.interval_seconds);
		return {
			enabled: s.enabled,
			intervalAmount,
			intervalUnit,
			overlap_policy: s.overlap_policy,
			catchup_policy: s.catchup_policy,
			tunablesText: JSON.stringify(s.tunables ?? {}, null, 2),
		};
	}

	function draftSeconds(d: Draft): number {
		const factor = INTERVAL_UNITS.find((u) => u.key === d.intervalUnit)?.factor ?? 1;
		return Math.round(d.intervalAmount * factor);
	}

	let schedules = $state<Schedule[]>([]);
	let drafts = $state<Record<string, Draft>>({});
	let schedulesLoading = $state(true);
	let loadError = $state('');
	// Per-row state keyed by job_name.
	let rowError = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});
	let runningNow = $state<Record<string, boolean>>({});

	async function loadSchedules() {
		schedulesLoading = true;
		loadError = '';
		try {
			const rows = await listSchedules();
			rows.sort((a, b) => a.job_name.localeCompare(b.job_name));
			schedules = rows;
			// Seed drafts for any row the operator isn't actively editing; preserve in-flight edits.
			const next: Record<string, Draft> = {};
			for (const s of rows) {
				next[s.job_name] = drafts[s.job_name] && isDirty(s, drafts[s.job_name])
					? drafts[s.job_name]
					: draftFrom(s);
			}
			drafts = next;
		} catch (e: unknown) {
			loadError = e instanceof Error ? e.message : 'Failed to load schedules';
		} finally {
			schedulesLoading = false;
		}
	}

	// Lightweight refresh that doesn't disturb the loading state or in-progress edits — used by the
	// poll to keep next-run / running badges current.
	async function refreshSchedulesSilently() {
		try {
			const rows = await listSchedules();
			rows.sort((a, b) => a.job_name.localeCompare(b.job_name));
			schedules = rows;
			const next: Record<string, Draft> = { ...drafts };
			for (const s of rows) {
				if (!next[s.job_name] || !isDirty(s, next[s.job_name])) {
					next[s.job_name] = draftFrom(s);
				}
			}
			drafts = next;
		} catch {
			// Transient refresh failures are ignored; the next poll retries.
		}
	}

	function isDirty(s: Schedule, d: Draft): boolean {
		if (d.enabled !== s.enabled) return true;
		if (draftSeconds(d) !== s.interval_seconds) return true;
		if (d.overlap_policy !== s.overlap_policy) return true;
		if (d.catchup_policy !== s.catchup_policy) return true;
		if (normalizeJson(d.tunablesText) !== JSON.stringify(s.tunables ?? {})) return true;
		return false;
	}

	// Canonical JSON string for comparison, or null when the text doesn't parse to an object.
	function normalizeJson(text: string): string | null {
		const trimmed = text.trim();
		if (trimmed === '') return JSON.stringify({});
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
			return JSON.stringify(parsed);
		} catch {
			return null;
		}
	}

	function dirty(s: Schedule): boolean {
		const d = drafts[s.job_name];
		return d ? isDirty(s, d) : false;
	}

	function diffFor(s: Schedule, d: Draft): ScheduleUpdate {
		const body: ScheduleUpdate = {};
		if (d.enabled !== s.enabled) body.enabled = d.enabled;
		const secs = draftSeconds(d);
		if (secs !== s.interval_seconds) body.interval_seconds = secs;
		if (d.overlap_policy !== s.overlap_policy) body.overlap_policy = d.overlap_policy;
		if (d.catchup_policy !== s.catchup_policy) body.catchup_policy = d.catchup_policy;
		const norm = normalizeJson(d.tunablesText);
		if (norm !== null && norm !== JSON.stringify(s.tunables ?? {})) {
			body.tunables = JSON.parse(norm);
		}
		return body;
	}

	async function save(s: Schedule) {
		const d = drafts[s.job_name];
		if (!d) return;
		rowError = { ...rowError, [s.job_name]: '' };

		if (draftSeconds(d) <= 0) {
			rowError = { ...rowError, [s.job_name]: 'Interval must be greater than zero.' };
			return;
		}
		if (normalizeJson(d.tunablesText) === null) {
			rowError = { ...rowError, [s.job_name]: 'Tunables must be a JSON object.' };
			return;
		}

		const body = diffFor(s, d);
		if (Object.keys(body).length === 0) return;

		saving = { ...saving, [s.job_name]: true };
		try {
			const updated = await updateSchedule(s.job_name, body);
			schedules = schedules.map((x) => (x.job_name === s.job_name ? updated : x));
			drafts = { ...drafts, [s.job_name]: draftFrom(updated) };
			toastStore.success(`Saved ${s.job_name}`);
		} catch (e: unknown) {
			// 400 carries a human-readable message in the body; surface it inline near the row.
			const msg =
				e instanceof ApiError
					? e.message || `Request failed (${e.status})`
					: e instanceof Error
						? e.message
						: 'Save failed';
			rowError = { ...rowError, [s.job_name]: msg };
		} finally {
			saving = { ...saving, [s.job_name]: false };
		}
	}

	function reset(s: Schedule) {
		drafts = { ...drafts, [s.job_name]: draftFrom(s) };
		rowError = { ...rowError, [s.job_name]: '' };
	}

	// Enable/disable is a one-field PATCH that applies immediately (it doesn't touch the draft's
	// other pending edits).
	async function toggleEnabled(s: Schedule) {
		saving = { ...saving, [s.job_name]: true };
		rowError = { ...rowError, [s.job_name]: '' };
		try {
			const updated = await updateSchedule(s.job_name, { enabled: !s.enabled });
			schedules = schedules.map((x) => (x.job_name === s.job_name ? updated : x));
			const d = drafts[s.job_name];
			drafts = { ...drafts, [s.job_name]: d ? { ...d, enabled: updated.enabled } : draftFrom(updated) };
			toastStore.success(updated.enabled ? `Enabled ${s.job_name}` : `Disabled ${s.job_name}`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Failed to update';
			rowError = { ...rowError, [s.job_name]: msg };
		} finally {
			saving = { ...saving, [s.job_name]: false };
		}
	}

	async function runNow(s: Schedule) {
		runningNow = { ...runningNow, [s.job_name]: true };
		rowError = { ...rowError, [s.job_name]: '' };
		try {
			const res = await runScheduleNow(s.job_name);
			if (res.enqueued) {
				toastStore.success(res.job_id ? `Enqueued ${s.job_name} (${res.job_id})` : `Enqueued ${s.job_name}`);
			} else {
				toastStore.info(`${s.job_name} was not enqueued (already running?)`);
			}
			await refreshSchedulesSilently();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Run failed';
			rowError = { ...rowError, [s.job_name]: msg };
		} finally {
			runningNow = { ...runningNow, [s.job_name]: false };
		}
	}

	// Audit drawer
	let auditOpen = $state(false);
	let auditJob = $state('');
	let auditEntries = $state<ScheduleAuditEntry[]>([]);
	let auditLoading = $state(false);
	let auditError = $state('');

	async function openAudit(s: Schedule) {
		auditJob = s.job_name;
		auditOpen = true;
		auditLoading = true;
		auditError = '';
		auditEntries = [];
		try {
			auditEntries = await getScheduleAudit(s.job_name);
		} catch (e: unknown) {
			auditError = e instanceof Error ? e.message : 'Failed to load history';
		} finally {
			auditLoading = false;
		}
	}
</script>

<svelte:head><title>System | River Data</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">System</h2>
	<Tabs tabs={tabLabels} bind:active />

	{#if activeKey === 'status'}
		<!-- Status: sync services -->
		{#if statusLoading}
			<p class="text-brand-muted">Loading…</p>
		{:else}
			<div class="flex justify-end">
				<Button variant="primary" onclick={() => openCreateDialog()}>New service credential</Button>
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
									<Button variant="primary" size="sm" onclick={() => sendCommand(svc.id, 'trigger_sync')}>Sync</Button>
									<ConfirmPopover message="Trigger a full sync (re-fetch all data)?" confirmLabel="Full Sync" confirmVariant="primary" onconfirm={() => sendCommand(svc.id, 'trigger_full_sync')}>
										<Button size="sm">Full Sync</Button>
									</ConfirmPopover>
								</div>

								<div>
									<div class="flex items-center justify-between mb-1">
										<h4 class="text-xs font-semibold uppercase tracking-wide text-brand-muted">Credentials</h4>
										<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => openCreateDialog(svc.service_type)}>+ New credential</Button>
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
	{:else if activeKey === 'logs'}
		<!-- Logs: API audit + sync events (admin-only) -->
		{#if isAdmin}
			<section class="space-y-2">
				<h3 class="text-sm font-semibold uppercase tracking-wide text-brand-muted">API Audit</h3>
				<ApiAuditPanel />
			</section>
			<section class="space-y-2">
				<h3 class="text-sm font-semibold uppercase tracking-wide text-brand-muted">Sync Events</h3>
				<SyncEventsPanel />
			</section>
		{:else}
			<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
				Administrator role required to view API audit and sync event logs.
			</div>
		{/if}
	{:else if activeKey === 'jobs'}
		<JobsPanel />
	{:else if activeKey === 'schedules'}
		<!-- Schedules: recurring background services -->
		<div class="flex items-center justify-between">
			<p class="text-sm text-brand-muted">
				Recurring background services. Edit cadence and policy, enable or disable a service, tune
				per-job settings, and trigger a run on demand.
			</p>
			<Button onclick={loadSchedules}>Refresh</Button>
		</div>

		{#if !isAdmin}
			<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
				Administrator role required to edit schedules. Values are shown read-only.
			</div>
		{/if}

		{#if schedulesLoading}
			<p class="text-sm text-brand-muted">Loading…</p>
		{:else if loadError}
			<ErrorNotice message={loadError} />
		{:else if schedules.length === 0}
			<p class="text-sm text-brand-muted">No schedules registered.</p>
		{:else}
			<div class="space-y-3">
				{#each schedules as s (s.job_name)}
					{@const d = drafts[s.job_name]}
					{@const isDirtyRow = dirty(s)}
					<div class="rounded-md border border-brand-divider bg-brand-surface">
						<!-- Row header: name, status, timing -->
						<div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-brand-divider">
							<div class="flex items-center gap-2">
								<span class="font-mono font-semibold text-brand-text">{s.job_name}</span>
								{#if s.running}
									<Badge variant="warning">Running now</Badge>
								{:else if s.enabled}
									<Badge variant="ok">Enabled</Badge>
								{:else}
									<Badge variant="muted">Disabled</Badge>
								{/if}
							</div>
							<div class="text-xs text-brand-muted">{formatInterval(s.interval_seconds)}</div>
							<div class="flex-1"></div>
							<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-brand-muted">
								<span>Next run: {s.next_run_at ? formatDateTime(s.next_run_at) : '—'}</span>
								<span>Last enqueued: {s.last_enqueued_at ? formatDateTime(s.last_enqueued_at) : '—'}</span>
							</div>
						</div>

						{#if d}
							<!-- Editable controls -->
							<div class="grid gap-4 px-4 py-3 md:grid-cols-2 lg:grid-cols-4">
								<div>
									<span class="block text-xs font-medium text-brand-muted mb-1">Interval</span>
									<div class="flex gap-2">
										<input
											type="number"
											min="1"
											step="1"
											disabled={!isAdmin}
											bind:value={d.intervalAmount}
											class="w-20 rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
										/>
										<select
											disabled={!isAdmin}
											bind:value={d.intervalUnit}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
										>
											{#each INTERVAL_UNITS as u}
												<option value={u.key}>{u.label}</option>
											{/each}
										</select>
									</div>
									<span class="mt-1 block text-[11px] text-brand-muted">{formatInterval(draftSeconds(d))}</span>
								</div>

								<div>
									<span class="block text-xs font-medium text-brand-muted mb-1">Enabled</span>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											disabled={!isAdmin || saving[s.job_name]}
											checked={s.enabled}
											onchange={() => toggleEnabled(s)}
											class="h-4 w-4 cursor-pointer disabled:cursor-default"
										/>
										<span class="text-brand-muted">{s.enabled ? 'On' : 'Off'}</span>
									</label>
								</div>

								<div>
									<label class="block text-xs font-medium text-brand-muted mb-1" for="overlap-{s.job_name}">Overlap policy</label>
									<select
										id="overlap-{s.job_name}"
										disabled={!isAdmin}
										bind:value={d.overlap_policy}
										class="w-full rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
									>
										{#each OVERLAP_OPTIONS as o}
											<option value={o.value}>{o.label}</option>
										{/each}
									</select>
								</div>

								<div>
									<label class="block text-xs font-medium text-brand-muted mb-1" for="catchup-{s.job_name}">Catchup policy</label>
									<select
										id="catchup-{s.job_name}"
										disabled={!isAdmin}
										bind:value={d.catchup_policy}
										class="w-full rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
									>
										{#each CATCHUP_OPTIONS as o}
											<option value={o.value}>{o.label}</option>
										{/each}
									</select>
								</div>

								<div class="md:col-span-2 lg:col-span-4">
									<label class="block text-xs font-medium text-brand-muted mb-1" for="tunables-{s.job_name}">Tunables (JSON)</label>
									<textarea
										id="tunables-{s.job_name}"
										disabled={!isAdmin}
										bind:value={d.tunablesText}
										rows="4"
										spellcheck="false"
										class="w-full rounded-md border border-brand-divider bg-brand-bg px-2 py-1 font-mono text-xs disabled:opacity-60"
									></textarea>
								</div>
							</div>

							{#if rowError[s.job_name]}
								<div class="px-4 pb-3">
									<ErrorNotice message={rowError[s.job_name]} />
								</div>
							{/if}

							<!-- Row actions -->
							<div class="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-brand-divider">
								<Button
									variant="primary"
									disabled={!isAdmin || !isDirtyRow || saving[s.job_name]}
									onclick={() => save(s)}
								>
									{saving[s.job_name] ? 'Saving…' : 'Save'}
								</Button>
								{#if isDirtyRow}
									<Button variant="ghost" disabled={saving[s.job_name]} onclick={() => reset(s)}>Discard</Button>
								{/if}
								<div class="flex-1"></div>
								<Button
									disabled={!isAdmin || runningNow[s.job_name]}
									onclick={() => runNow(s)}
								>
									{runningNow[s.job_name] ? 'Enqueuing…' : 'Run now'}
								</Button>
								<Button variant="ghost" onclick={() => openAudit(s)}>History</Button>
							</div>

							{#if s.updated_at}
								<div class="px-4 pb-3 text-[11px] text-brand-muted">
									Last changed {formatDateTime(s.updated_at)}{s.updated_by ? ` by ${s.updated_by}` : ''}
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
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
		<Button onclick={() => createDialog = false}>Cancel</Button>
		<Button variant="primary" onclick={handleCreateCredential}>Create</Button>
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
		<Button variant="primary" onclick={() => { if (newCredential) navigator.clipboard.writeText(newCredential.client_secret); toastStore.success('Copied'); }}>Copy Secret</Button>
		<Button onclick={() => credentialDialog = false}>Done</Button>
	{/snippet}
</Dialog>

<!-- Schedule Change History Dialog -->
<Dialog bind:open={auditOpen} title="Change history — {auditJob}" maxWidth="md">
	{#snippet children()}
		{#if auditLoading}
			<p class="text-sm text-brand-muted">Loading…</p>
		{:else if auditError}
			<ErrorNotice message={auditError} />
		{:else if auditEntries.length === 0}
			<p class="text-sm text-brand-muted">No changes recorded.</p>
		{:else}
			<div class="space-y-3">
				{#each auditEntries as entry}
					<div class="rounded-md border border-brand-divider bg-brand-bg p-3">
						<div class="mb-2 flex items-center justify-between text-xs text-brand-muted">
							<span>{formatDateTime(entry.changed_at)}</span>
							<span>{entry.changed_by ?? 'system'}</span>
						</div>
						<div class="grid gap-3 md:grid-cols-2">
							<div>
								<span class="block text-[11px] font-medium uppercase tracking-wide text-brand-muted mb-1">Before</span>
								<pre class="whitespace-pre-wrap break-words rounded bg-brand-surface p-2 font-mono text-[11px] text-brand-text">{JSON.stringify(entry.old_value, null, 2)}</pre>
							</div>
							<div>
								<span class="block text-[11px] font-medium uppercase tracking-wide text-brand-muted mb-1">After</span>
								<pre class="whitespace-pre-wrap break-words rounded bg-brand-surface p-2 font-mono text-[11px] text-brand-text">{JSON.stringify(entry.new_value, null, 2)}</pre>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<Button onclick={() => (auditOpen = false)}>Close</Button>
	{/snippet}
</Dialog>
