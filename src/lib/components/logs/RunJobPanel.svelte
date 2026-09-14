<script lang="ts">
	// Every job kind a person may run off its cadence, and the inputs each one declares. The
	// controls are built from those declarations, so a kind that needs a site asks for a site and
	// nothing asks for JSON.
	import { onMount } from 'svelte';
	import { api, type Sensor } from '$api/crud';
	import {
		getUnpairedSummary,
		listRunnableJobs,
		runScheduleNow,
		type ParamSpec,
		type RunnableJob,
	} from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { fromDatetimeLocal, triggerLabel } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import SiteSelect from '$components/SiteSelect.svelte';
	import ParameterSelect from '$components/ParameterSelect.svelte';

	let { canRun = false }: { canRun?: boolean } = $props();

	let jobs = $state<RunnableJob[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let sensors = $state<Sensor[]>([]);
	let sourceSystems = $state<string[]>([]);
	let inputs = $state<Record<string, Record<string, string>>>({});
	let running = $state<Record<string, boolean>>({});
	let rowError = $state<Record<string, string>>({});
	let expanded = $state('');

	onMount(async () => {
		try {
			jobs = await listRunnableJobs();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load the runnable jobs';
		} finally {
			loading = false;
		}
		// The pickers the declarations name. A failure here leaves the control empty rather than
		// the panel broken: every other kind still runs.
		await Promise.all([
			api.sensors
				.list({ perPage: 500, sort: ['name', 'ASC'] })
				.then((r) => (sensors = r.data))
				.catch(() => (sensors = [])),
			getUnpairedSummary()
				.then((r) => (sourceSystems = r.map((s) => s.source_system)))
				.catch(() => (sourceSystems = [])),
		]);
	});

	function specs(job: RunnableJob): ParamSpec[] {
		return job.manual_run.offer === 'declared' ? job.manual_run.params : [];
	}

	/** A list-valued input has no control here yet, so it is not asked for and the run means all. */
	function offered(spec: ParamSpec): boolean {
		return spec.kind !== 'uuid_list' && spec.kind !== 'pair_list';
	}

	function held(job: string, name: string): string {
		return inputs[job]?.[name] ?? '';
	}

	function set(job: string, name: string, value: string) {
		inputs = { ...inputs, [job]: { ...(inputs[job] ?? {}), [name]: value } };
	}

	const missing = $derived.by(() => {
		const out: Record<string, string[]> = {};
		for (const job of jobs) {
			out[job.job_name] = specs(job)
				.filter((s) => s.required && offered(s) && !held(job.job_name, s.name))
				.map((s) => s.label);
		}
		return out;
	});

	function body(job: RunnableJob): Record<string, unknown> {
		const supplied: Record<string, unknown> = {};
		for (const spec of specs(job)) {
			const raw = held(job.job_name, spec.name);
			if (!offered(spec) || raw === '') continue;
			if (spec.kind === 'instant') supplied[spec.name] = fromDatetimeLocal(raw);
			else if (spec.kind === 'number') supplied[spec.name] = Number(raw);
			else if (spec.kind === 'bool') supplied[spec.name] = raw === 'true';
			else supplied[spec.name] = raw;
		}
		return supplied;
	}

	async function run(job: RunnableJob) {
		const name = job.job_name;
		running = { ...running, [name]: true };
		rowError = { ...rowError, [name]: '' };
		try {
			const supplied = body(job);
			const res = await runScheduleNow(name, Object.keys(supplied).length ? supplied : undefined);
			if (res.enqueued) {
				toastStore.success(res.job_id ? `Enqueued ${name} (${res.job_id})` : `Enqueued ${name}`);
			} else {
				toastStore.info(`${name} was not enqueued (already running?)`);
			}
		} catch (e) {
			rowError = { ...rowError, [name]: e instanceof Error ? e.message : 'Run failed' };
		} finally {
			running = { ...running, [name]: false };
		}
	}

	function cadence(job: RunnableJob): string {
		if (job.interval_seconds == null) return 'on demand';
		const every = `every ${job.interval_seconds}s`;
		return job.enabled === false ? `${every}, off` : every;
	}
</script>

<div class="space-y-3">
	<p class="text-sm text-brand-muted">
		Every job that can be run by hand. A kind whose inputs come from the route that enqueues it
		(a CSV import, a replay of stored timestamps) is not listed.
	</p>

	{#if loading}
		<p class="text-sm text-brand-muted">Loading…</p>
	{:else if loadError}
		<ErrorNotice message={loadError} />
	{:else}
		<div class="divide-y divide-brand-divider rounded-md border border-brand-divider">
			{#each jobs as job (job.job_name)}
				{@const declared = specs(job).filter(offered)}
				<div class="px-4 py-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium">{triggerLabel(job.job_name)}</span>
						<span class="text-xs text-brand-muted">{cadence(job)}</span>
						<div class="flex-1"></div>
						{#if declared.length > 0}
							<Button
								variant="ghost"
								onclick={() => (expanded = expanded === job.job_name ? '' : job.job_name)}
							>
								{expanded === job.job_name ? 'Hide inputs' : `Inputs (${declared.length})`}
							</Button>
						{/if}
						<Button
							disabled={!canRun ||
								running[job.job_name] ||
								(missing[job.job_name]?.length ?? 0) > 0}
							onclick={() => void run(job)}
						>
							{running[job.job_name] ? 'Enqueuing…' : 'Run'}
						</Button>
					</div>

					{#if (missing[job.job_name]?.length ?? 0) > 0 && expanded !== job.job_name}
						<p class="mt-1 text-xs text-brand-muted">
							Needs {missing[job.job_name].join(', ')}
						</p>
					{/if}

					{#if expanded === job.job_name}
						<div class="mt-3 grid gap-3 sm:grid-cols-2">
							{#each declared as spec (spec.name)}
								<div class="flex flex-col gap-1">
									<label for="run-{job.job_name}-{spec.name}" class="text-xs font-medium text-brand-muted">
										{spec.label}{spec.required ? ' *' : ''}
									</label>
									{#if spec.name === 'site_id'}
										<SiteSelect
											id="run-{job.job_name}-{spec.name}"
											value={held(job.job_name, spec.name)}
											onchange={(v: string) => set(job.job_name, spec.name, v)}
										/>
									{:else if spec.name === 'parameter_id'}
										<ParameterSelect
											id="run-{job.job_name}-{spec.name}"
											global
											bind:value={
												() => held(job.job_name, spec.name),
												(v) => set(job.job_name, spec.name, v)
											}
										/>
									{:else if spec.name === 'sensor_id'}
										<select
											id="run-{job.job_name}-{spec.name}"
											value={held(job.job_name, spec.name)}
											onchange={(e) => set(job.job_name, spec.name, e.currentTarget.value)}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm"
										>
											<option value=""> - Select instrument - </option>
											{#each sensors as sensor (sensor.id)}
												<option value={sensor.id}>{sensor.name ?? sensor.serial_number ?? sensor.id}</option>
											{/each}
										</select>
									{:else if spec.name === 'source_system'}
										<select
											id="run-{job.job_name}-{spec.name}"
											value={held(job.job_name, spec.name)}
											onchange={(e) => set(job.job_name, spec.name, e.currentTarget.value)}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm"
										>
											<option value=""> - Select source - </option>
											{#each sourceSystems as source (source)}
												<option value={source}>{source}</option>
											{/each}
										</select>
									{:else if spec.kind === 'instant'}
										<input
											id="run-{job.job_name}-{spec.name}"
											type="datetime-local"
											value={held(job.job_name, spec.name)}
											onchange={(e) => set(job.job_name, spec.name, e.currentTarget.value)}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm"
										/>
									{:else if spec.kind === 'bool'}
										<select
											id="run-{job.job_name}-{spec.name}"
											value={held(job.job_name, spec.name)}
											onchange={(e) => set(job.job_name, spec.name, e.currentTarget.value)}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm"
										>
											<option value="">-</option>
											<option value="true">Yes</option>
											<option value="false">No</option>
										</select>
									{:else}
										<input
											id="run-{job.job_name}-{spec.name}"
											type={spec.kind === 'number' ? 'number' : 'text'}
											step={spec.kind === 'number' ? 'any' : undefined}
											value={held(job.job_name, spec.name)}
											onchange={(e) => set(job.job_name, spec.name, e.currentTarget.value)}
											class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1 text-sm"
										/>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if rowError[job.job_name]}
						<div class="mt-2"><ErrorNotice message={rowError[job.job_name]} /></div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
