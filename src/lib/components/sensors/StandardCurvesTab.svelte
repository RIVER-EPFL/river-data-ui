<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { api, type StandardCurve } from '$api/crud';
	import {
		getCurveUsage,
		getInstrumentsOverview,
		getSensorCurveUsage,
		retireStandardCurve,
		unretireStandardCurve,
		type CurveUsageResponse,
		type InstrumentStreamRef,
		type SensorCurveUsage,
	} from '$api/service';
	import { ApiError } from '$api/client';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import CrudList from '$components/crud/CrudList.svelte';
	import OriginFilter from '$components/crud/OriginFilter.svelte';
	import { originFilter, type Origin } from '$lib/origin';
	import { instrumentInspection, streamInspectionHref } from '$lib/instruments/inspection';
	import type { Column, PageRequest } from '$components/crud/CrudList.svelte';
	import CopyStandardCurvesDialog from '$components/dialogs/CopyStandardCurvesDialog.svelte';
	import NewStandardCurveForm from './NewStandardCurveForm.svelte';
	import {
		curveEquation,
		curveLabel,
		curveOrigin,
		apiMessage,
		emptyCurveForm,
		parseCurveForm,
		uniqueCurveName,
		type CurveForm,
	} from '$lib/standardCurves';

	// A standard curve belongs to one instrument and is picked by hand for a single measurement, so
	// this list is always scoped to `sensorId` and has no time axis to order by; newest first is the
	// only ordering that means anything here.
	let {
		sensorId,
		sensorName,
		focusCurveId = null,
	}: {
		sensorId: string;
		sensorName: string;
		/** Curve to highlight, from the ?tab=curves&curve=<id> deep link. */
		focusCurveId?: string | null;
	} = $props();

	let curves = $state<StandardCurve[]>([]);
	let copyOpen = $state(false);
	let usage = $state<Record<string, SensorCurveUsage>>({});
	let usageDetails = $state<Record<string, CurveUsageResponse>>({});
	let usageDetailError = $state<Record<string, string>>({});
	let openUsageId = $state<string | null>(null);
	let usageDetailLoading = $state<string | null>(null);
	let streams = $state<InstrumentStreamRef[]>([]);
	let streamsLoading = $state(true);
	let streamsError = $state<string | null>(null);
	let list = $state<ReturnType<typeof CrudList> | null>(null);
	let origin = $state<Origin>('any');
	// The source systems these curves were replicated from, which is what the filter can offer.
	const curveSources = $derived([
		...new Set(curves.map((c) => c.source_system).filter((s): s is string => !!s)),
	]);

	const canWrite = $derived(me.can('writeFieldMetadata'));
	const canInspect = $derived(me.can('manageSensors'));
	const existingNames = $derived(curves.map((c) => c.name).filter((n): n is string => !!n));

	onMount(() => {
		if (canInspect) void loadStreams();
	});

	async function loadStreams() {
		try {
			const response = await getInstrumentsOverview();
			streams = instrumentInspection(response.instruments, sensorId)?.streams ?? [];
		} catch (e) {
			streamsError = e instanceof Error ? e.message : 'Failed to load incoming streams';
		} finally {
			streamsLoading = false;
		}
	}

	const columns: Column[] = [
		{ key: 'name', label: 'Name', sortable: false },
		{ key: 'fitted_on', label: 'Fitted', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'source', label: 'Source', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'equation', label: 'Equation', sortable: false, class: 'font-mono text-xs' },
		{ key: 'r_squared', label: 'R²', sortable: false, class: 'font-mono text-xs' },
		{ key: 'readings', label: 'Readings', sortable: false, class: 'font-mono text-xs' },
		{ key: 'first_used', label: 'First used', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'last_used', label: 'Last used', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'created_at', label: 'Created', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'created_by', label: 'Created by', sortable: false, class: 'text-xs text-brand-muted' },
		{ key: 'notes', label: 'Notes', sortable: false, class: 'text-xs text-brand-muted' },
	];

	async function loadCurves({ page, perPage }: PageRequest) {
		const res = await api.standardCurves.list({
			page,
			perPage,
			filter: { sensor_id: sensorId, ...originFilter(origin, 'source_system') },
			sort: ['created_at', 'DESC'],
		});
		curves = res.data;
		await loadUsage();
		return { data: res.data, total: res.total };
	}

	// Usage decides which rows can still be edited or deleted, so it is loaded with the list rather
	// than left to the write's refusal. A failure leaves the figures unknown and the actions enabled.
	async function loadUsage() {
		try {
			const res = await getSensorCurveUsage(sensorId);
			usage = Object.fromEntries(res.usage.map((u) => [u.curve_id, u]));
		} catch {
			usage = {};
		}
	}

	function usedCount(curve: StandardCurve): number {
		return usage[curve.id]?.reading_count ?? 0;
	}

	function frozenTitle(curve: StandardCurve): string | undefined {
		const n = usedCount(curve);
		return n > 0
			? `${n} reading${n === 1 ? ' was' : 's were'} corrected with this curve, so its coefficients are frozen and it cannot be deleted. Duplicate it and re-enter those measurements against the copy.`
			: undefined;
	}

	async function toggleUsageDetails(curve: StandardCurve) {
		if (openUsageId === curve.id) {
			openUsageId = null;
			return;
		}
		openUsageId = curve.id;
		if (usageDetails[curve.id] || usedCount(curve) === 0) return;
		usageDetailLoading = curve.id;
		try {
			usageDetails = { ...usageDetails, [curve.id]: await getCurveUsage(curve.id) };
			usageDetailError = { ...usageDetailError, [curve.id]: '' };
		} catch (e) {
			usageDetailError = {
				...usageDetailError,
				[curve.id]: e instanceof Error ? e.message : 'Failed to load corrected readings',
			};
		} finally {
			usageDetailLoading = null;
		}
	}

	// ─── Create, which is also duplicate and corrected copy ───
	// One form serves all three: a duplicate is a create seeded from another row's values, and that is
	// exactly what an operator needs when an edit is refused because the curve is already in use.
	let createOpen = $state(false);
	let form = $state<CurveForm>({ ...emptyCurveForm });
	let saving = $state(false);

	function openCreate(seed?: Partial<CurveForm>) {
		form = { ...emptyCurveForm, ...seed };
		createOpen = true;
	}

	function formOf(curve: StandardCurve): CurveForm {
		return {
			name: curve.name ?? '',
			fitted_on: curve.fitted_on ?? '',
			slope: String(curve.slope),
			intercept: String(curve.intercept),
			r_squared: curve.r_squared == null ? '' : String(curve.r_squared),
			notes: curve.notes ?? '',
		};
	}

	function openDuplicate(curve: StandardCurve, seed?: CurveForm) {
		openCreate({
			...(seed ?? formOf(curve)),
			name: uniqueCurveName(curveLabel(curve), existingNames),
		});
	}

	function onCreated() {
		toastStore.success('Standard curve added');
		createOpen = false;
		form = { ...emptyCurveForm };
		list?.reload();
	}

	// ─── Edit and delete, and the refusal they can meet ───
	// A curve any reading was corrected with is frozen (name and notes excepted) and cannot be deleted. The API
	// reports that state only by refusing the write, so the refusal is caught per row and explained
	// where the operator clicked, alongside the corrected-copy path they actually need.
	let editingId = $state<string | null>(null);
	let editForm = $state<CurveForm>({ ...emptyCurveForm });
	let rowError = $state<{ id: string; message: string; seed: CurveForm | null } | null>(null);

	function startEdit(curve: StandardCurve) {
		editingId = curve.id;
		rowError = null;
		editForm = formOf(curve);
	}

	async function saveEdit(curve: StandardCurve) {
		const parsed = parseCurveForm(editForm);
		if ('error' in parsed) {
			rowError = { id: curve.id, message: parsed.error, seed: null };
			return;
		}
		saving = true;
		try {
			// A used curve's fit is frozen, so only its labels are sent.
			const values = usedCount(curve) > 0
				? { name: parsed.values.name, notes: parsed.values.notes }
				: parsed.values;
			await api.standardCurves.update(curve.id, values);
			toastStore.success('Standard curve updated');
			editingId = null;
			rowError = null;
			list?.refresh();
		} catch (e) {
			rowError = {
				id: curve.id,
				message: apiMessage(e),
				// A 400 is the freeze: keep what was typed so the corrected copy carries it.
				seed: e instanceof ApiError && e.status === 400 ? { ...editForm } : null,
			};
		} finally {
			saving = false;
		}
	}

	async function deleteCurve(curve: StandardCurve) {
		try {
			await api.standardCurves.remove(curve.id);
			toastStore.success('Standard curve deleted');
			rowError = null;
			list?.refresh();
		} catch (e) {
			rowError = { id: curve.id, message: apiMessage(e), seed: null };
		}
	}

	// ─── Retire, which is how a curve leaves circulation ───
	// A used curve cannot be deleted and must not stay in the picker forever: retiring it takes it
	// out of the picker and changes no stored value, because a standard curve is named by the
	// reading rather than resolved by time.
	async function retire(curve: StandardCurve) {
		try {
			await retireStandardCurve(curve.id);
			toastStore.success(
				`Curve retired. ${usedCount(curve)} reading${usedCount(curve) === 1 ? '' : 's'} keep it and their values.`,
			);
			rowError = null;
			list?.refresh();
		} catch (e) {
			rowError = { id: curve.id, message: apiMessage(e), seed: null };
		}
	}

	async function unretire(curve: StandardCurve) {
		try {
			await unretireStandardCurve(curve.id);
			toastStore.success('Curve is offered again');
			rowError = null;
			list?.refresh();
		} catch (e) {
			rowError = { id: curve.id, message: apiMessage(e), seed: null };
		}
	}

	function correctedCopyFrom(curve: StandardCurve) {
		const seed = rowError?.seed ?? undefined;
		editingId = null;
		rowError = null;
		openDuplicate(curve, seed);
	}
</script>

<div class="space-y-3">
	<div class="flex items-start gap-3 flex-wrap">
		<p class="text-sm text-brand-muted max-w-2xl">
			Curves belong to this instrument and are chosen by hand when a grab sample is entered, never
			by time.
		</p>
		{#if canWrite}
			<div class="flex gap-2 ml-auto">
				<Button onclick={() => (copyOpen = true)}>Copy curves…</Button>
				<Button variant="primary" onclick={() => (createOpen ? (createOpen = false) : openCreate())}>
					{createOpen ? 'Cancel' : 'Add curve'}
				</Button>
			</div>
		{/if}
	</div>

	{#if canWrite && curves.length > 0}
		<p class="text-xs text-brand-muted max-w-2xl">
			A curve freezes once a reading is corrected with it: only its notes stay editable, and it
			cannot be deleted. Correcting one means duplicating it and re-entering the affected
			measurements against the copy. Readings below counts what each curve corrected.
		</p>
	{/if}

	{#if createOpen}
		{#key form}
			<NewStandardCurveForm
				{sensorId}
				{sensorName}
				seed={form}
				oncreated={onCreated}
				oncancel={() => (createOpen = false)}
			/>
		{/key}
	{/if}

	{#if canInspect}
		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2">
			<h3 class="text-sm font-semibold">Incoming streams</h3>
			{#if streamsLoading}
				<p class="text-xs text-brand-muted">Loading streams…</p>
			{:else if streamsError}
				<ErrorNotice message={streamsError} />
			{:else if streams.length === 0}
				<p class="text-xs text-brand-muted">No sync streams feed this instrument.</p>
			{:else}
				<ul class="space-y-1 text-xs">
					{#each streams as stream (stream.id)}
						<li class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<a
								href={streamInspectionHref(stream, base)}
								class="font-mono text-brand-primary no-underline hover:underline"
							>{stream.source_system}:{stream.source_key}</a>
							{#if stream.site_name}
								<span class="text-brand-muted">→ {stream.site_name} / {stream.parameter_code}</span>
							{:else}
								<span class="text-brand-muted">Unpaired</span>
							{/if}
							{#if stream.measurement_type}
								<span class="text-brand-muted">{stream.measurement_type}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	<CrudList
		bind:this={list}
		load={loadCurves}
		{columns}
		title="Standard curves"
		showHeader={false}
		actions={canInspect || canWrite ? rowActions : undefined}
		actionsLabel="Actions"
		rowClass={(c: StandardCurve) => (c.id === focusCurveId ? 'bg-brand-primary/5' : '')}
	>
		{#snippet filterBar({ reload }: { reload: () => void })}
			<OriginFilter bind:value={origin} sources={curveSources} onchange={reload} />
		{/snippet}

		{#snippet empty()}
			{#if !createOpen}
				<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-8 text-center space-y-3">
					<h3 class="text-sm font-semibold">No standard curves on this instrument.</h3>
					<p class="text-sm text-brand-muted max-w-xl mx-auto">
						Add one here, or copy a curve from another instrument.
					</p>
					{#if canWrite}
						<div class="flex gap-2 justify-center">
							<Button variant="primary" onclick={() => openCreate()}>Add curve</Button>
							<Button onclick={() => (copyOpen = true)}>Copy curves…</Button>
						</div>
					{/if}
				</div>
			{/if}
		{/snippet}

		{#snippet cell({ column, row, text }: { column: Column; row: StandardCurve; text: string })}
			{#if column.key === 'name'}
				{curveLabel(row)}
				{#if row.retired_at}
					<span
						class="ml-2 rounded bg-brand-bg px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-muted"
						title={`Retired ${formatDateTime(row.retired_at)}${row.retired_reason ? `: ${row.retired_reason}` : ''}. It is no longer offered for a new measurement.`}
					>Retired</span>
				{/if}
			{:else if column.key === 'source'}
				{curveOrigin(row)}
			{:else if column.key === 'equation'}
				{curveEquation(row)}
			{:else if column.key === 'readings'}
				{usedCount(row)}
			{:else if column.key === 'first_used'}
				{usage[row.id]?.first_used ? formatDateTime(usage[row.id].first_used!) : 'None'}
			{:else if column.key === 'last_used'}
				{usage[row.id]?.last_used ? formatDateTime(usage[row.id].last_used!) : 'None'}
			{:else if column.key === 'created_at'}
				{formatDateTime(row.created_at)}
			{:else}
				{text}
			{/if}
		{/snippet}

		{#snippet rowDetail({ row, colCount }: { row: StandardCurve; colCount: number })}
			{#if openUsageId === row.id}
				<tr class="border-b border-brand-divider bg-brand-bg/40">
					<td colspan={colCount} class="px-4 py-3">
						<div class="sticky left-0 w-max max-w-[calc(100vw-3rem)] space-y-2">
							{#if usageDetailLoading === row.id}
								<p class="text-xs text-brand-muted">Loading readings…</p>
							{:else if usageDetailError[row.id]}
								<ErrorNotice message={usageDetailError[row.id]} />
							{:else if usageDetails[row.id]}
								{@const detail = usageDetails[row.id]}
								<p class="text-xs text-brand-muted">
									{detail.reading_count} readings corrected{detail.reading_count > detail.points.length ? `, most recent ${detail.points.length} shown` : ''}
								</p>
								<div class="max-h-56 overflow-y-auto">
									<table class="w-full text-xs">
										<thead>
											<tr class="text-brand-muted">
												<th class="text-left py-0.5 pr-4 font-medium">Time</th>
												<th class="text-left py-0.5 pr-4 font-medium">Site</th>
												<th class="text-left py-0.5 pr-4 font-medium">Parameter</th>
												<th class="text-right py-0.5 px-2 font-medium">Rep</th>
												<th class="text-right py-0.5 px-2 font-medium">Raw</th>
												<th class="text-right py-0.5 pl-2 font-medium">Corrected</th>
											</tr>
										</thead>
										<tbody>
											{#each detail.points as point (point.time + ':' + point.replicate_index)}
												<tr class={point.is_flagged ? 'text-severity-warning-text' : ''}>
													<td class="py-0.5 pr-4">{formatDateTime(point.time)}</td>
													<td class="py-0.5 pr-4">{point.site_name ?? '-'}</td>
													<td class="py-0.5 pr-4">{point.parameter_code ?? '-'}</td>
													<td class="py-0.5 px-2 text-right font-mono">{point.replicate_index}</td>
													<td class="py-0.5 px-2 text-right font-mono">{point.raw_value}</td>
													<td class="py-0.5 pl-2 text-right font-mono">{point.calibrated_value ?? '-'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{:else}
								<p class="text-xs text-brand-muted">No corrected readings.</p>
							{/if}
						</div>
					</td>
				</tr>
			{/if}
			{#if editingId === row.id}
				<tr class="border-b border-brand-divider bg-brand-bg/40">
					<td colspan={colCount} class="px-4 py-3 space-y-3">
						{#if usedCount(row) > 0}
							<p class="text-xs text-brand-muted">
								{usedCount(row)} reading{usedCount(row) === 1 ? ' was' : 's were'} corrected with this curve, so its fit date and coefficients are frozen and it cannot be deleted. Its name and notes stay editable. Duplicate it to correct the coefficients, then re-enter those measurements against the copy.
							</p>
						{/if}
						<div class="grid grid-cols-4 gap-3">
							<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">Name<input type="text" bind:value={editForm.name} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm disabled:opacity-60" /></label>
							<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">Fit date<input type="date" bind:value={editForm.fitted_on} disabled={usedCount(row) > 0} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm disabled:opacity-60" /></label>
							<label class="flex flex-col gap-1 text-xs text-brand-muted">Slope<input type="number" step="any" bind:value={editForm.slope} disabled={usedCount(row) > 0} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono disabled:opacity-60" /></label>
							<label class="flex flex-col gap-1 text-xs text-brand-muted">Intercept<input type="number" step="any" bind:value={editForm.intercept} disabled={usedCount(row) > 0} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono disabled:opacity-60" /></label>
							<label class="flex flex-col gap-1 text-xs text-brand-muted">R²<input type="number" step="any" bind:value={editForm.r_squared} disabled={usedCount(row) > 0} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono disabled:opacity-60" /></label>
							<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-3">Notes<input type="text" bind:value={editForm.notes} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
						</div>
						<div class="flex items-center gap-3">
							<Button variant="primary" onclick={() => saveEdit(row)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
							<Button variant="ghost" onclick={() => { editingId = null; rowError = null; }}>Cancel</Button>
							<span class="text-[11px] text-brand-muted">Recorded against {sensorName}.</span>
						</div>
					</td>
				</tr>
			{/if}
			{#if rowError?.id === row.id}
				<tr class="border-b border-brand-divider bg-brand-bg/40">
					<td colspan={colCount} class="px-4 py-3">
						<ErrorNotice>
							<div class="space-y-2">
								<p>{rowError.message}</p>
								<div class="flex gap-2">
									<Button variant="primary" size="sm" onclick={() => correctedCopyFrom(row)}>Create corrected copy</Button>
									<Button variant="ghost" size="sm" onclick={() => (rowError = null)}>Dismiss</Button>
								</div>
							</div>
						</ErrorNotice>
					</td>
				</tr>
			{/if}
		{/snippet}
	</CrudList>
</div>

{#snippet rowActions(curve: StandardCurve)}
	<div class="flex gap-3">
		{#if canInspect && usedCount(curve) > 0}
			<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => toggleUsageDetails(curve)}>
				{openUsageId === curve.id ? 'Close readings' : 'Inspect readings'}
			</Button>
		{/if}
		{#if canWrite}
			<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => openDuplicate(curve)}>Duplicate</Button>
			<Button variant="ghost" size="sm" class="text-brand-primary" disabled={!!curve.source_system} title={curve.source_system ? `Replicated from ${curve.source_system}; the next sync cycle re-asserts its coefficients, so an edit here would not survive. Correct it in the portal.` : frozenTitle(curve)} onclick={() => (editingId === curve.id ? (editingId = null) : startEdit(curve))}>{editingId === curve.id ? 'Close' : 'Edit'}</Button>
			{#if curve.retired_at}
			<ConfirmPopover
				message="Offer this curve again? It returns to the picker for new measurements. Nothing stored changes."
				confirmLabel="Unretire"
				onconfirm={() => unretire(curve)}
			>
				<Button variant="ghost" size="sm" class="text-brand-primary">Unretire</Button>
			</ConfirmPopover>
			{:else}
			<ConfirmPopover
				message={`Retire this curve? It stops being offered for new measurements. The ${usedCount(curve)} reading${usedCount(curve) === 1 ? '' : 's'} corrected with it keep it and keep their values, the row and its provenance stay, and retiring is reversible.`}
				confirmLabel="Retire"
				onconfirm={() => retire(curve)}
			>
				<Button variant="ghost" size="sm" class="text-brand-primary">Retire</Button>
			</ConfirmPopover>
			{/if}
			{#if usedCount(curve) > 0}
				<Button variant="ghost" size="sm" class="text-severity-alarm" disabled title={frozenTitle(curve)}>Delete</Button>
			{:else}
				<ConfirmPopover
					message="Delete this standard curve? Nothing was corrected with it."
					confirmLabel="Delete"
					onconfirm={() => deleteCurve(curve)}
				>
					<Button variant="ghost" size="sm" class="text-severity-alarm">Delete</Button>
				</ConfirmPopover>
			{/if}
		{/if}
	</div>
{/snippet}

<CopyStandardCurvesDialog
	bind:open={copyOpen}
	targetSensorId={sensorId}
	targetSensorName={sensorName}
	{existingNames}
	onsuccess={() => list?.reload()}
/>
