<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, type ReprocessingJob } from '$api/crud';
	import {
		getUnpairedSummary,
		getReconciliationCandidates,
		startReplicateReconciliation,
		startReconciliationDelete,
		type ReconciliationFamily,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime, triggerLabel, statusBadgeClass } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';

	// Migrates readings from legacy per-avg-column streams onto their replicate-family streams.
	// Step 1 overview → step 2 migrate+verify (tracked job) → step 3 verification report →
	// step 4 delete of the obsolete avg streams behind a typed confirmation. The migrate job never
	// deletes; the delete job re-verifies before removing anything.

	// ── URL-driven wizard state (browser back/forward and reload recovery) ──
	type Step = 'overview' | 'run' | 'report' | 'delete';
	const step = $derived<Step>((page.url.searchParams.get('step') as Step) || 'overview');
	const source = $derived(page.url.searchParams.get('source') ?? '');
	const jobIdParam = $derived(page.url.searchParams.get('job') ?? '');

	function nav(mutate: (url: URL) => void) {
		const url = new URL(page.url);
		mutate(url);
		goto(url.toString(), { noScroll: true });
	}

	function goOverview() {
		nav((url) => {
			url.searchParams.delete('step');
			url.searchParams.delete('job');
			url.searchParams.delete('source');
		});
	}

	// ── Step 1: candidates per source system ──
	interface SourceCandidates {
		source_system: string;
		families: ReconciliationFamily[];
		total_old_streams: number;
	}

	const NON_INSTRUMENT_SOURCES = ['api', 'grab_sample'];
	let candidates = $state<SourceCandidates[]>([]);
	let candidatesLoading = $state(true);
	let candidatesError = $state('');

	async function loadCandidates() {
		candidatesLoading = true;
		candidatesError = '';
		try {
			const summary = await getUnpairedSummary();
			const sources = summary
				.map((s) => s.source_system)
				.filter((s) => !NON_INSTRUMENT_SOURCES.includes(s));
			const results = await Promise.all(
				sources.map(async (s) => {
					try {
						const r = await getReconciliationCandidates(s);
						return { source_system: s, families: r.families, total_old_streams: r.total_old_streams };
					} catch {
						return null;
					}
				}),
			);
			candidates = results.filter(
				(r): r is SourceCandidates => r !== null && (r.families.length > 0 || r.total_old_streams > 0),
			);
		} catch (e) {
			candidatesError = e instanceof Error ? e.message : 'Failed to load candidates';
		} finally {
			candidatesLoading = false;
		}
	}

	function candidatesFor(sourceSystem: string): SourceCandidates | undefined {
		return candidates.find((c) => c.source_system === sourceSystem);
	}

	// ── Job polling (steps 2-4; recovers from ?job= on reload) ──
	interface ReconMismatch {
		family: string;
		time: string;
		old_value: number | null;
		new_value: number | null;
		delta: number | null;
	}
	interface ReconDetail {
		scope?: Record<string, unknown>;
		counts?: Record<string, number>;
		mismatches?: ReconMismatch[];
	}

	const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

	let job = $state<ReprocessingJob | null>(null);
	let starting = $state(false);

	const jobDetail = $derived((job?.detail ?? {}) as ReconDetail);
	const jobSource = $derived(
		typeof jobDetail.scope?.source_system === 'string' ? (jobDetail.scope.source_system as string) : source,
	);
	const jobIsDryRun = $derived(jobDetail.scope?.dry_run === true);
	const mismatches = $derived(jobDetail.mismatches ?? []);
	const countEntries = $derived(Object.entries(jobDetail.counts ?? {}));

	$effect(() => {
		const id = jobIdParam;
		if (!id) {
			job = null;
			return;
		}
		let cancelled = false;
		async function tick() {
			try {
				const j = await api.reprocessingJobs.get(id);
				if (cancelled) return;
				job = j;
				syncStepWithJob(j);
				if (TERMINAL.has(j.status)) clearInterval(t);
			} catch {
				// Transient poll failure; the next tick retries.
			}
		}
		const t = setInterval(tick, 1500);
		tick();
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	});

	// A deep link carries only ?job=; place the wizard on the step the job's kind and state imply.
	function syncStepWithJob(j: ReprocessingJob) {
		const detail = (j.detail ?? {}) as ReconDetail;
		const src = typeof detail.scope?.source_system === 'string' ? (detail.scope.source_system as string) : source;
		const isDelete = j.trigger_type === 'replicate_reconciliation_delete';
		const target: Step = isDelete ? 'delete' : j.status === 'completed' ? 'report' : 'run';
		if (step !== target || (src !== '' && source !== src)) {
			nav((url) => {
				url.searchParams.set('step', target);
				if (src) url.searchParams.set('source', src);
			});
		}
	}

	function progressPercent(j: ReprocessingJob): number | null {
		if (j.status === 'completed') return 100;
		if (j.total && j.total > 0 && j.progress != null) {
			return Math.min(100, Math.round((j.progress / j.total) * 100));
		}
		return null;
	}

	// ── Step 2: start migrate + verify ──
	function startRun(sourceSystem: string) {
		nav((url) => {
			url.searchParams.set('step', 'run');
			url.searchParams.set('source', sourceSystem);
			url.searchParams.delete('job');
		});
	}

	async function runMigration(dryRun: boolean) {
		if (!source) return;
		starting = true;
		try {
			const { job_id } = await startReplicateReconciliation(source, dryRun);
			job = null;
			nav((url) => {
				url.searchParams.set('step', 'run');
				url.searchParams.set('source', source);
				url.searchParams.set('job', job_id);
			});
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to start migration');
		} finally {
			starting = false;
		}
	}

	// ── Step 3 → 4: verification report and destructive delete ──
	let mismatchPage = $state(1);
	const MISMATCHES_PER_PAGE = 20;
	const pagedMismatches = $derived(
		mismatches.slice((mismatchPage - 1) * MISMATCHES_PER_PAGE, mismatchPage * MISMATCHES_PER_PAGE),
	);

	let deleteConfirmText = $state('');

	function goDelete() {
		deleteConfirmText = '';
		nav((url) => {
			url.searchParams.set('step', 'delete');
			if (jobSource) url.searchParams.set('source', jobSource);
			url.searchParams.delete('job');
		});
	}

	async function runDelete() {
		if (!source || deleteConfirmText !== source) return;
		starting = true;
		try {
			const { job_id } = await startReconciliationDelete(source);
			job = null;
			nav((url) => {
				url.searchParams.set('step', 'delete');
				url.searchParams.set('source', source);
				url.searchParams.set('job', job_id);
			});
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to start cleanup');
		} finally {
			starting = false;
		}
	}

	function fmtValue(v: number | null): string {
		if (v == null) return '–';
		return Number(v.toFixed(6)).toString();
	}

	onMount(loadCandidates);
</script>

<svelte:head><title>Replicate Reconciliation | RIVER Data</title></svelte:head>

<div class="space-y-4">
	<div class="flex items-center gap-3">
		{#if step === 'overview'}
			<a href="{base}/streams" class="text-sm text-brand-primary no-underline hover:underline">&larr; Back to streams</a>
		{:else}
			<Button variant="ghost" size="sm" onclick={goOverview} class="text-brand-primary">&larr; Overview</Button>
		{/if}
		<h2 class="text-xl font-semibold">Replicate Reconciliation</h2>
	</div>

	<!-- ── STEP 1: OVERVIEW ── -->
	{#if step === 'overview'}
		<p class="text-sm text-brand-muted max-w-3xl">
			Legacy portal syncs stored each precomputed <span class="font-mono">_avg</span> column as its
			own stream. Reconciliation migrates those readings onto the replicate-family streams
			(migrate + verify, nothing is deleted), then a separate cleanup pass re-verifies and removes
			the obsolete avg streams.
		</p>

		{#if candidatesLoading}
			<p class="text-sm text-brand-muted">Loading candidates…</p>
		{:else if candidatesError}
			<ErrorNotice message={candidatesError} />
		{:else if candidates.length === 0}
			<p class="text-sm text-severity-ok">No legacy avg streams left to reconcile.</p>
		{:else}
			{#each candidates as c (c.source_system)}
				{@const readyCount = c.families.filter((f) => f.ready).length}
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-brand-divider">
						<span class="font-semibold">{c.source_system}</span>
						<span class="text-xs text-brand-muted">
							{c.families.length} famil{c.families.length === 1 ? 'y' : 'ies'} ·
							{readyCount} ready ·
							{c.total_old_streams} old stream{c.total_old_streams === 1 ? '' : 's'} ·
							{c.families.reduce((n, f) => n + f.old_readings, 0).toLocaleString()} old readings
						</span>
						<div class="flex-1"></div>
						<Button
							variant="primary"
							size="sm"
							disabled={c.families.length === 0}
							onclick={() => startRun(c.source_system)}
						>Start migration</Button>
					</div>
					{#if c.families.length > 0}
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Family stream</th>
								<th class="text-left px-4 py-2 font-semibold">Old avg stream</th>
								<th class="text-right px-4 py-2 font-semibold">Old readings</th>
								<th class="text-right px-4 py-2 font-semibold" title="Old-stream instants the family stream has no readings for; zero means ready for cutover">Missing instants</th>
								<th class="text-left px-4 py-2 font-semibold">Readiness</th>
							</tr></thead>
							<tbody>
								{#each c.families as f}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 font-mono text-xs">{f.family_source_key}</td>
										<td class="px-4 py-2 font-mono text-xs text-brand-muted">{f.old_source_key}</td>
										<td class="px-4 py-2 text-right font-mono text-xs">{f.old_readings.toLocaleString()}</td>
										<td class="px-4 py-2 text-right font-mono text-xs">{f.missing_instants.toLocaleString()}</td>
										<td class="px-4 py-2">
											{#if f.ready}
												<Badge variant="ok">Ready</Badge>
											{:else}
												<Badge variant="warning">Not ready</Badge>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			{/each}
		{/if}

	<!-- ── STEP 2: MIGRATE + VERIFY ── -->
	{:else if step === 'run'}
		<div class="max-w-2xl space-y-4">
			<h3 class="text-lg font-semibold">Migrate & verify: {source}</h3>

			{#if !jobIdParam}
				{@const c = candidatesFor(source)}
				{#if c}
					<p class="text-sm text-brand-muted">
						{c.families.length} famil{c.families.length === 1 ? 'y' : 'ies'} will be migrated
						({c.families.reduce((n, f) => n + f.old_readings, 0).toLocaleString()} readings on
						{c.total_old_streams} old stream{c.total_old_streams === 1 ? '' : 's'}).
					</p>
				{/if}
				<p class="text-sm text-brand-muted">
					The tracked job migrates readings from the old avg streams onto the replicate families
					and then verifies every migrated instant. Nothing is deleted in this step.
				</p>
				<div class="flex gap-3">
					<Button disabled={starting} onclick={() => runMigration(true)}>Dry run</Button>
					<Button variant="primary" disabled={starting} onclick={() => runMigration(false)}>
						{starting ? 'Starting…' : 'Migrate + verify'}
					</Button>
				</div>
			{:else if !job}
				<p class="text-sm text-brand-muted">Loading job…</p>
			{:else}
				{@const pct = progressPercent(job)}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-sm">{triggerLabel(job.trigger_type)}</span>
						{#if jobIsDryRun}<Badge variant="muted">Dry run</Badge>{/if}
						<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(job.status)}">{job.status}</span>
						<span class="ml-auto text-xs text-brand-muted">{formatDateTime(job.created_at)}</span>
					</div>
					<div class="flex items-center gap-2">
						<div class="flex-1 h-1.5 bg-brand-bg rounded overflow-hidden">
							<div class="h-full bg-brand-primary transition-[width] duration-300" style:width="{pct ?? 0}%"></div>
						</div>
						<span class="text-[10px] font-mono text-brand-muted whitespace-nowrap">
							{#if job.total != null && job.progress != null}{job.progress}/{job.total}{:else}{job.status}{/if}
						</span>
					</div>
					{#if countEntries.length > 0}
						<div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
							{#each countEntries as [name, value]}
								<div class="p-2 bg-brand-bg rounded">
									<span class="block text-brand-muted">{name}</span>
									<span class="font-mono">{value.toLocaleString()}</span>
								</div>
							{/each}
						</div>
					{/if}
					{#if job.error_message}
						<ErrorNotice message={job.error_message} />
					{/if}
				</div>
				{#if job.status === 'failed'}
					<div class="flex gap-3">
						<Button onclick={() => nav((url) => url.searchParams.delete('job'))}>Try again</Button>
					</div>
				{/if}
			{/if}
		</div>

	<!-- ── STEP 3: VERIFICATION REPORT ── -->
	{:else if step === 'report'}
		<div class="space-y-4">
			<h3 class="text-lg font-semibold">Verification report: {jobSource}</h3>

			{#if !job}
				<p class="text-sm text-brand-muted">Loading job…</p>
			{:else}
				{#if mismatches.length === 0}
					<div class="rounded-md border border-severity-ok bg-severity-ok-soft p-4 text-sm">
						<span class="font-semibold">Verified.</span> Every migrated instant matches the old
						avg stream's value{jobIsDryRun ? ' (dry run, nothing was written)' : ''}.
					</div>
				{:else}
					<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft p-4 text-sm text-severity-warning-text">
						<span class="font-semibold">{mismatches.length}{mismatches.length === 100 ? '+' : ''} mismatch{mismatches.length === 1 ? '' : 'es'}.</span>
						The old avg value and the recomputed family mean disagree at these instants (first 100
						shown). Do not run the cleanup until the disagreement is understood.
					</div>
				{/if}

				{#if countEntries.length > 0}
					<div class="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
						{#each countEntries as [name, value]}
							<div class="p-3 bg-brand-bg rounded">
								<span class="block text-xs text-brand-muted">{name}</span>
								<span class="font-mono text-lg">{value.toLocaleString()}</span>
							</div>
						{/each}
					</div>
				{/if}

				{#if mismatches.length > 0}
					<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
						<table class="w-full text-sm">
							<thead><tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Family</th>
								<th class="text-left px-4 py-2 font-semibold">Instant</th>
								<th class="text-right px-4 py-2 font-semibold">Old value</th>
								<th class="text-right px-4 py-2 font-semibold">New value</th>
								<th class="text-right px-4 py-2 font-semibold">Δ</th>
							</tr></thead>
							<tbody>
								{#each pagedMismatches as m}
									<tr class="border-b border-brand-divider last:border-b-0">
										<td class="px-4 py-2 font-mono text-xs">{m.family}</td>
										<td class="px-4 py-2 text-xs">{formatDateTime(m.time)}</td>
										<td class="px-4 py-2 text-right font-mono text-xs">{fmtValue(m.old_value)}</td>
										<td class="px-4 py-2 text-right font-mono text-xs">{fmtValue(m.new_value)}</td>
										<td class="px-4 py-2 text-right font-mono text-xs text-severity-warning-text">{fmtValue(m.delta)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<PaginationControls
						total={mismatches.length}
						page={mismatchPage}
						perPage={MISMATCHES_PER_PAGE}
						onPageChange={(p) => (mismatchPage = p)}
					/>
				{/if}

				<div class="flex gap-3">
					<Button onclick={goOverview}>Back to overview</Button>
					{#if !jobIsDryRun && job.status === 'completed'}
						<Button variant="danger" onclick={goDelete}>Continue to cleanup…</Button>
					{/if}
				</div>
			{/if}
		</div>

	<!-- ── STEP 4: DESTRUCTIVE DELETE ── -->
	{:else if step === 'delete'}
		<div class="max-w-2xl space-y-4">
			<h3 class="text-lg font-semibold">Delete obsolete avg streams: {source}</h3>

			{#if !jobIdParam}
				<div class="rounded-md border border-severity-alarm bg-severity-alarm-soft p-4 text-sm space-y-2">
					<p class="font-semibold text-severity-alarm">This permanently deletes data.</p>
					<p>
						The cleanup job re-verifies every migrated instant and then deletes the obsolete
						per-avg-column streams for <span class="font-mono">{source}</span> along with their
						readings. It refuses to delete anything that fails re-verification.
					</p>
				</div>
				<label class="block text-sm">
					<span class="text-brand-muted">Type <span class="font-mono font-semibold">{source}</span> to confirm</span>
					<input
						type="text"
						bind:value={deleteConfirmText}
						placeholder={source}
						class="mt-1 w-full px-3 py-2 border border-brand-divider rounded-md text-sm bg-brand-surface font-mono"
					/>
				</label>
				<div class="flex gap-3">
					<Button onclick={goOverview}>Cancel</Button>
					<Button
						variant="danger"
						disabled={deleteConfirmText !== source || starting}
						onclick={runDelete}
					>{starting ? 'Starting…' : 'Delete obsolete streams'}</Button>
				</div>
			{:else if !job}
				<p class="text-sm text-brand-muted">Loading job…</p>
			{:else}
				{@const pct = progressPercent(job)}
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-sm">{triggerLabel(job.trigger_type)}</span>
						<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusBadgeClass(job.status)}">{job.status}</span>
						<span class="ml-auto text-xs text-brand-muted">{formatDateTime(job.created_at)}</span>
					</div>
					{#if !TERMINAL.has(job.status)}
						<div class="flex items-center gap-2">
							<div class="flex-1 h-1.5 bg-brand-bg rounded overflow-hidden">
								<div class="h-full bg-brand-primary transition-[width] duration-300" style:width="{pct ?? 0}%"></div>
							</div>
							<span class="text-[10px] font-mono text-brand-muted whitespace-nowrap">
								{#if job.total != null && job.progress != null}{job.progress}/{job.total}{:else}{job.status}{/if}
							</span>
						</div>
					{/if}
					{#if countEntries.length > 0}
						<div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
							{#each countEntries as [name, value]}
								<div class="p-2 bg-brand-bg rounded">
									<span class="block text-brand-muted">{name}</span>
									<span class="font-mono">{value.toLocaleString()}</span>
								</div>
							{/each}
						</div>
					{/if}
					{#if job.error_message}
						<ErrorNotice message={job.error_message} />
					{/if}
				</div>
				{#if job.status === 'completed'}
					<div class="rounded-md border border-severity-ok bg-severity-ok-soft p-4 text-sm">
						Cleanup complete. The obsolete avg streams for
						<span class="font-mono">{source}</span> are gone.
					</div>
					<Button variant="primary" onclick={() => goto(`${base}/streams`)}>Done</Button>
				{:else if job.status === 'failed'}
					<Button onclick={() => nav((url) => url.searchParams.delete('job'))}>Try again</Button>
				{/if}
			{/if}
		</div>
	{/if}
</div>
