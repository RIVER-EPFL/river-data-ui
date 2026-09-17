<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { createUrlTab } from '$lib/urlTab.svelte';
	import { me } from '$auth/me.svelte';
	import {
		listSchedules,
		updateSchedule,
		runScheduleNow,
		getScheduleAudit,
		type Schedule,
		type ScheduleUpdate,
		type ScheduleAuditEntry,
		type OverlapPolicy,
		type CatchupPolicy,
	} from '$api/service';
	import { ApiError } from '$api/client';
	import { toastStore } from '$lib/stores/toast.svelte';
	import {
		formatDateTime,
		formatInterval,
		countLabel,
	} from '$lib/utils';
	import Tabs from '$components/ui/Tabs.svelte';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import JobsPanel from '$components/logs/JobsPanel.svelte';
	import ApiAuditPanel from '$components/logs/ApiAuditPanel.svelte';
	import SyncEventsPanel from '$components/logs/SyncEventsPanel.svelte';
	import NotificationHealthNotice from '$components/notifications/NotificationHealthNotice.svelte';
	import InvariantReportsPanel from '$components/logs/InvariantReportsPanel.svelte';
	import RunJobPanel from '$components/logs/RunJobPanel.svelte';

	// Local-only mode and the Administrator role both hold the admin capability. The API-audit /
	// sync-events panels and schedule edits need admin; non-admins see a notice rather than failing
	// requests.
	const isAdmin = $derived(me.can('admin'));

	// ── Tabs ──────────────────────────────────────────────────────────────────
	const tabLabels = ['Status', 'Logs', 'Jobs', 'Schedules'];
	// Legacy /logs tab keys fold into the Logs tab here.
	const tab = createUrlTab({
		keys: ['status', 'logs', 'jobs', 'schedules'],
		aliases: { audit: 'logs', sync: 'logs' },
	});

	// The Audits view moved to /streams; old deep links follow it there. Captured synchronously so
	// the tab writeback rewriting ?tab can't erase the request before the redirect fires.
	const requestedTab = page.url.searchParams.get('tab');
	// A notification links to the job it announced; read once, before the tab writeback rewrites
	// the query.
	const requestedJob = page.url.searchParams.get('job');
	// A synced reading's point record links to the services of its source system.
	const requestedService = page.url.searchParams.get('service');
	onMount(() => {
		if (requestedService) {
			goto(`${base}/streams?tab=services&service=${encodeURIComponent(requestedService)}`, {
				replaceState: true,
			});
			return;
		}
		if (requestedTab === 'audits' || requestedTab === 'replicate_audits' || requestedTab === 'holds') {
			goto(`${base}/streams?tab=review&review=actionable`, { replaceState: true });
		}
	});

	// Load (and poll) only the data the active tab needs. Jobs / Logs use self-fetching panels.
	$effect(() => {
		const key = tab.key;
		if (key === 'schedules') {
			loadSchedules();
			const t = setInterval(refreshSchedulesSilently, 10_000);
			return () => clearInterval(t);
		}
	});

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
	// tunables are one field per key the job declares.
	interface Draft {
		enabled: boolean;
		intervalAmount: number;
		intervalUnit: IntervalUnit;
		overlap_policy: OverlapPolicy;
		catchup_policy: CatchupPolicy;
		tunables: Record<string, unknown>;
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

	// A schedule's interval and policies are nullable, and the scheduler reads an unset or unknown
	// policy as its own default, so the form shows what the server would act on.
	function draftFrom(s: Schedule): Draft {
		const { intervalAmount, intervalUnit } = splitInterval(s.interval_seconds ?? 0);
		return {
			enabled: s.enabled,
			intervalAmount,
			intervalUnit,
			overlap_policy:
				s.overlap_policy === 'allow_concurrent' ? 'allow_concurrent' : 'skip_if_running',
			catchup_policy: s.catchup_policy === 'skip' ? 'skip' : 'run_once',
			tunables: { ...(s.tunables ?? {}) },
		};
	}

	function setTunable(d: Draft, key: string, value: unknown) {
		d.tunables = { ...d.tunables, [key]: value };
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

	// Lightweight refresh that doesn't disturb the loading state or in-progress edits, used by the
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
		if (JSON.stringify(d.tunables) !== JSON.stringify(s.tunables ?? {})) return true;
		return false;
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
		if (JSON.stringify(d.tunables) !== JSON.stringify(s.tunables ?? {})) {
			body.tunables = d.tunables;
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

<svelte:head><title>System | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<h2 class="text-xl font-semibold">System</h2>
	<Tabs tabs={tabLabels} bind:active={tab.index} />

	{#if tab.key === 'status'}
		<NotificationHealthNotice enabled={isAdmin} />
		<InvariantReportsPanel />
	{:else if tab.key === 'logs'}
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
	{:else if tab.key === 'jobs'}
		<JobsPanel openJobId={requestedJob} />
	{:else if tab.key === 'schedules'}
		<!-- Run by hand: every kind, whether or not it has a cadence -->
		<section class="space-y-2">
			<h3 class="text-sm font-semibold uppercase tracking-wide text-brand-muted">Run a job</h3>
			<RunJobPanel canRun={isAdmin} />
		</section>

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
								<span>Next run: {s.next_run_at ? formatDateTime(s.next_run_at) : '-'}</span>
								<span>Last enqueued: {s.last_enqueued_at ? formatDateTime(s.last_enqueued_at) : '-'}</span>
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

								{#if s.tunables_schema.length === 0}
									<div class="md:col-span-2 lg:col-span-4 text-xs text-brand-muted">
										No tunables. This job reads nothing beyond its schedule.
									</div>
								{:else}
									{#each s.tunables_schema as spec (spec.key)}
										<div>
											<label class="block text-xs font-medium text-brand-muted mb-1" for="tunable-{s.job_name}-{spec.key}">
												{countLabel(spec.key)}
											</label>
											{#if spec.kind.type === 'boolean'}
												<input
													id="tunable-{s.job_name}-{spec.key}"
													type="checkbox"
													disabled={!isAdmin}
													checked={Boolean(d.tunables[spec.key] ?? spec.default)}
													onchange={(e) => setTunable(d, spec.key, e.currentTarget.checked)}
												/>
											{:else if spec.kind.type === 'enum'}
												<select
													id="tunable-{s.job_name}-{spec.key}"
													disabled={!isAdmin}
													value={String(d.tunables[spec.key] ?? spec.default)}
													onchange={(e) => setTunable(d, spec.key, e.currentTarget.value)}
													class="w-full rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
												>
													{#each spec.kind.options ?? [] as option (option)}
														<option value={option}>{option}</option>
													{/each}
												</select>
											{:else}
												<input
													id="tunable-{s.job_name}-{spec.key}"
													type="number"
													disabled={!isAdmin}
													min={spec.min ?? undefined}
													max={spec.max ?? undefined}
													value={Number(d.tunables[spec.key] ?? spec.default)}
													onchange={(e) => setTunable(d, spec.key, Number(e.currentTarget.value))}
													class="w-full rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm disabled:opacity-60"
												/>
											{/if}
											<p class="mt-1 text-[11px] text-brand-muted">{spec.help}</p>
										</div>
									{/each}
								{/if}
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

<!-- Schedule Change History Dialog -->
<Dialog bind:open={auditOpen} title="Change history: {auditJob}" maxWidth="md">
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
