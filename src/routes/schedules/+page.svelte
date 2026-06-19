<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { auth } from '$auth/keycloak.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, formatInterval } from '$lib/utils';
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
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// Local-only mode and Administrator role both resolve to 'admin'. Editing schedules needs
	// write_metadata on the backend; non-admins see a read-only notice rather than failing writes.
	const isAdmin = $derived(auth.role === 'admin');

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
	let loading = $state(true);
	let loadError = $state('');
	// Per-row state keyed by job_name.
	let rowError = $state<Record<string, string>>({});
	let saving = $state<Record<string, boolean>>({});
	let runningNow = $state<Record<string, boolean>>({});
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function load() {
		loading = true;
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
			loading = false;
		}
	}

	// Lightweight refresh that doesn't disturb the loading state or in-progress edits — used by the
	// poll to keep next-run / running badges current.
	async function refreshSilently() {
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
			await refreshSilently();
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

	onMount(async () => {
		await load();
		pollTimer = setInterval(refreshSilently, 10000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<svelte:head><title>Schedules | River Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold">Schedules</h2>
		<Button onclick={load}>Refresh</Button>
	</div>

	<p class="text-sm text-brand-muted">
		Recurring background services. Edit cadence and policy, enable or disable a service, tune
		per-job settings, and trigger a run on demand.
	</p>

	{#if !isAdmin}
		<div class="p-3 bg-severity-warning-soft border border-severity-warning-border rounded-md text-sm">
			Administrator role required to edit schedules. Values are shown read-only.
		</div>
	{/if}

	{#if loading}
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
</div>

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
