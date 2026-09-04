<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import {
		commitEdit,
		getCalculationClosure,
		getCollectionEventDetail,
		previewEdit,
		rollbackEditSet,
		saveGrabSample,
		type CalculationImpact,
		type EventDetailResponse,
	} from '$api/service';
	import {
		addParameterRow,
		addableParameters,
		applyPaste,
		clearedCells,
		columnCount,
		gridFromVisit,
		pendingWrites,
		stagedVisitFrom,
		touchedParameters,
		withColumns,
		type ConfiguredParameter,
		type GridRow,
	} from '$lib/visits/grid';
	import { api } from '$api/crud';
	import { goto } from '$app/navigation';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import CurvePicker, {
		emptyCurveSelection,
		type CurveSelection,
	} from '$components/tools/CurvePicker.svelte';
	import { editConsequence } from '$lib/visits/role';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// The visit as the portal's Database grid, filtered to one date (M50, orientation from I18):
	// parameters down, replicates across, the statistics the trigger maintains beside them. A
	// value a calculation writes is read-only here; it is changed by changing what it reads.
	const eventId = $derived(page.params.id ?? '');

	let detail = $state<EventDetailResponse | null>(null);
	let rows = $state<GridRow[]>([]);
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);
	let confirmOpen = $state(false);
	let consequence = $state<string | null>(null);
	let calculations = $state<CalculationImpact[]>([]);
	let focused = $state<{ row: number; column: number } | null>(null);
	let configured = $state<ConfiguredParameter[]>([]);
	let chosenParameter = $state('');
	// The row whose curve is being picked, and the picker's own state while the dialog is open.
	let curveRow = $state<number | null>(null);
	let curveOpen = $state(false);
	let curveSelection = $state<CurveSelection>(emptyCurveSelection());
	// The visit's retraction: what withdrawing it would cover, and the set that undoes it.
	let withdrawOpen = $state(false);
	let withdrawing = $state(false);
	let withdrawPreviewId = $state('');
	let withdrawRows = $state(0);
	let withdrawnSetId = $state('');
	// Which instrument each curve belongs to: a reading naming a curve names its instrument too.
	let curveSensors = $state<Record<string, string>>({});

	const width = $derived(columnCount(rows));
	const addable = $derived(addableParameters(rows, configured));
	const writes = $derived(pendingWrites(rows));
	const cleared = $derived(clearedCells(rows));

	$effect(() => {
		const id = eventId;
		if (!id) return;
		loading = true;
		getCollectionEventDetail(id)
			.then((d) => {
				detail = d;
				rows = withColumns(gridFromVisit(d), columnCount(gridFromVisit(d)));
				error = '';
			})
			.then(() => loadConfigured(detail!.site_id))
			.catch((e) => (error = e instanceof Error ? e.message : 'Could not load the visit'))
			.finally(() => (loading = false));
	});

	/** The site's configured parameters, so a visit can take a value it has never held before. */
	async function loadConfigured(siteId: string) {
		const [slots, catalog] = await Promise.all([
			api.siteParameters.list({ perPage: 500, filter: { site_id: siteId } }),
			api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] }),
		]);
		const byId = new Map(catalog.data.map((p) => [p.id, p]));
		configured = slots.data
			.filter((slot) => !slot.is_derived && byId.has(slot.parameter_id))
			.map((slot) => {
				const parameter = byId.get(slot.parameter_id)!;
				return {
					parameterId: parameter.id,
					code: parameter.code,
					name: slot.name ?? parameter.name ?? parameter.code,
				};
			})
			.sort((a, b) => a.code.localeCompare(b.code));
	}

	/** Open the calculation that writes a row, at this visit, with what it reads already loaded. */
	async function openCalculation(tool: string) {
		const visit = detail;
		if (!visit) return;
		let siteName = '';
		try {
			siteName = (await api.sites.get(visit.site_id)).name;
		} catch {
			// The name is a label on the staging bar; the visit is identified by its ids.
		}
		stagedVisit.set(stagedVisitFrom(visit, siteName));
		await goto(`${base}/tools?tool=${encodeURIComponent(tool)}`);
	}

	function addParameter() {
		const parameter = addable.find((p) => p.parameterId === chosenParameter);
		if (!parameter) return;
		rows = addParameterRow(rows, parameter);
		chosenParameter = '';
	}

	function openCurvePicker(rowIndex: number) {
		curveRow = rowIndex;
		curveOpen = true;
		const curveId = rows[rowIndex].standardCurveId ?? null;
		curveSelection = curveId
			? { standardCurveId: curveId, sensorId: curveSensors[curveId] ?? null, slope: null, intercept: null, label: null }
			: emptyCurveSelection();
	}

	function applyCurve() {
		const rowIndex = curveRow;
		if (rowIndex === null) return;
		const curveId = curveSelection.standardCurveId;
		if (curveId && curveSelection.sensorId) {
			curveSensors = { ...curveSensors, [curveId]: curveSelection.sensorId };
		}
		rows = rows.map((r, i) => (i === rowIndex ? { ...r, standardCurveId: curveId ?? undefined } : r));
		curveOpen = false;
	}

	/** The instrument a curve belongs to, from the picker's own answer or the stored curve. */
	async function sensorForCurve(curveId: string): Promise<string> {
		const known = curveSensors[curveId];
		if (known) return known;
		const curve = await api.standardCurves.get(curveId);
		curveSensors = { ...curveSensors, [curveId]: curve.sensor_id };
		return curve.sensor_id;
	}

	function setCell(rowIndex: number, column: number, raw: string) {
		const text = raw.trim();
		const parsed = text === '' ? null : Number(text);
		if (parsed !== null && Number.isNaN(parsed)) return;
		const next = rows.map((r) => ({ ...r, replicates: r.replicates.map((c) => ({ ...c })) }));
		next[rowIndex].replicates[column].value = parsed;
		rows = next;
	}

	function onPaste(event: ClipboardEvent, rowIndex: number, column: number) {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (!text.includes('\t') && !text.includes('\n')) return;
		event.preventDefault();
		rows = applyPaste(rows, rowIndex, column, text);
	}

	function addReplicate() {
		rows = withColumns(rows, width + 1);
	}

	function removeReplicate() {
		if (width <= 1) return;
		// A column holding a stored reading is not dropped by a layout gesture: withdrawing a
		// measurement is a decision, taken on the reading.
		if (rows.some((r) => r.replicates[width - 1]?.stored !== null)) {
			toastStore.error('That column holds stored readings; withdraw them from the point record.');
			return;
		}
		rows = withColumns(rows, width - 1);
	}

	function reset() {
		if (detail) rows = withColumns(gridFromVisit(detail), width);
	}

	/** What saving would recompute, read before the write rather than discovered after it. */
	async function askToSave() {
		consequence = null;
		calculations = [];
		const parameters = touchedParameters(rows);
		if (parameters.length > 0) {
			try {
				const closure = await getCalculationClosure({ parameter_ids: parameters.join(',') });
				calculations = closure.calculations;
				consequence = editConsequence(closure.calculations);
			} catch {
				consequence = null;
			}
		}
		confirmOpen = true;
	}

	async function save() {
		const visit = detail;
		if (!visit) return;
		saving = true;
		try {
			// A value nothing computed is corrected in place through the edit primitive; a replicate
			// the visit did not hold is an entry, so it goes through the grab write path (Q8).
			for (const write of writes.filter((w) => w.corrects)) {
				const selection = {
					keys: [
						{
							stream_id: write.streamId,
							time: visit.collected_at,
							replicate_index: write.replicateIndex,
						},
					],
				};
				const decision = {
					kind: 'value_correction' as const,
					value: write.value,
					reason: 'corrected in the visit grid',
				};
				const preview = await previewEdit(selection, decision);
				await commitEdit(selection, decision, preview.preview_id);
			}
			const entries = writes.filter((w) => !w.corrects);
			if (entries.length > 0) {
				const readings = [];
				for (const w of entries) {
					readings.push({
						parameter_id: w.parameterId,
						value: w.value,
						time: visit.collected_at,
						replicate_index: w.replicateIndex,
						...(w.standardCurveId
							? {
									standard_curve_id: w.standardCurveId,
									sensor_id: await sensorForCurve(w.standardCurveId),
								}
							: {}),
					});
				}
				await saveGrabSample({ site_id: visit.site_id, mode: 'replace', readings });
			}
			toastStore.success(`${writes.length} value${writes.length === 1 ? '' : 's'} saved`);
			confirmOpen = false;
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			confirmOpen = false;
		} finally {
			saving = false;
		}
	}

	async function refresh() {
		const fresh = await getCollectionEventDetail(eventId);
		detail = fresh;
		rows = withColumns(gridFromVisit(fresh), columnCount(gridFromVisit(fresh)));
	}

	async function askToWithdraw() {
		const visit = detail;
		if (!visit) return;
		error = '';
		consequence = null;
		calculations = [];
		try {
			const decision = { kind: 'withdraw' as const, reason: 'visit withdrawn' };
			const preview = await previewEdit({ collection_event_id: visit.id }, decision);
			withdrawPreviewId = preview.preview_id;
			withdrawRows = preview.rows.length;
			calculations = preview.calculations;
			consequence = editConsequence(preview.calculations);
			withdrawOpen = true;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function withdrawVisit() {
		const visit = detail;
		if (!visit) return;
		withdrawing = true;
		try {
			const committed = await commitEdit(
				{ collection_event_id: visit.id },
				{ kind: 'withdraw', reason: 'visit withdrawn' },
				withdrawPreviewId,
			);
			withdrawnSetId = committed.set_id;
			toastStore.success(
				`${committed.rows_decided} reading${committed.rows_decided === 1 ? '' : 's'} withdrawn`,
			);
			withdrawOpen = false;
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			withdrawOpen = false;
		} finally {
			withdrawing = false;
		}
	}

	async function undoWithdrawal() {
		if (!withdrawnSetId) return;
		withdrawing = true;
		try {
			const rolled = await rollbackEditSet(withdrawnSetId);
			withdrawnSetId = '';
			toastStore.success(
				`${rolled.rolled_back} reading${rolled.rolled_back === 1 ? '' : 's'} re-asserted`,
			);
			await refresh();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			withdrawing = false;
		}
	}

	function fmt(v: number | undefined): string {
		return v === undefined || v === null ? '—' : String(v);
	}
</script>

<svelte:head><title>Visit | RIVER Data</title></svelte:head>

<div class="space-y-4">
	{#if loading}
		<p class="text-sm text-brand-muted">Loading the visit…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else if detail}
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-xl font-semibold">
				Visit of {formatDateTime(detail.collected_at)}
			</h2>
			<a class="text-sm text-brand-primary hover:underline" href="{base}/sites/{detail.site_id}?tab=visits&event={detail.id}"
				>Back to the site</a
			>
		</div>

		<div class="flex flex-wrap items-center gap-2 text-sm">
			<Button size="sm" onclick={addReplicate}>Add replicate column</Button>
			<Button size="sm" onclick={removeReplicate}>Remove replicate column</Button>
			<span class="text-brand-muted">
				Paste a spreadsheet block into any cell: it fills rightward and downward, and a blank
				cell stays a gap.
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-2 text-sm">
			<label for="add-parameter">Add a parameter</label>
			<select
				id="add-parameter"
				bind:value={chosenParameter}
				disabled={addable.length === 0}
				class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1"
			>
				<option value="">
					{addable.length === 0 ? 'Every configured parameter is on the grid' : 'Choose a parameter'}
				</option>
				{#each addable as parameter (parameter.parameterId)}
					<option value={parameter.parameterId}>{parameter.name} ({parameter.code})</option>
				{/each}
			</select>
			<Button size="sm" disabled={chosenParameter === ''} onclick={addParameter}>Add row</Button>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<thead>
					<tr class="text-left text-xs uppercase tracking-wide text-gray-500">
						<th class="px-2 py-1">Parameter</th>
						<th class="px-2 py-1">Curve</th>
						{#each Array.from({ length: width }, (_, i) => i) as column (column)}
							<th class="px-2 py-1">Rep {column + 1}</th>
						{/each}
						<th class="px-2 py-1">n</th>
						<th class="px-2 py-1">Mean</th>
						<th class="px-2 py-1">SD</th>
						<th class="px-2 py-1">Min</th>
						<th class="px-2 py-1">Max</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, rowIndex (row.parameterId)}
						<tr class="border-t border-gray-100 dark:border-gray-800">
							<th
								scope="row"
								class="px-2 py-1 text-left font-medium {row.roleClass}"
								title={row.roleTitle ?? undefined}
							>
								{row.parameterName}
								{#if row.writtenBy}
									<button
										type="button"
										class="ml-1 text-xs text-brand-primary hover:underline"
										title="Open {row.writtenBy} at this visit, with what it reads loaded"
										onclick={() => openCalculation(row.writtenBy!)}
									>computed by {row.writtenBy}</button>
								{/if}
							</th>
							<td class="px-2 py-1">
								{#if row.writtenBy}
									<span class="text-brand-muted">—</span>
								{:else}
									<button
										type="button"
										class="text-brand-primary hover:underline"
										onclick={() => openCurvePicker(rowIndex)}
									>{row.standardCurveId ? 'Curve set' : 'Set curve'}</button>
								{/if}
							</td>
							{#each row.replicates as cell, column (column)}
								<td class="px-1 py-1">
									{#if row.writtenBy}
										<span class="px-1 text-brand-muted">{cell.value ?? '—'}</span>
									{:else}
										<input
											class="w-20 rounded border px-1 py-0.5 {cell.value !== cell.stored
												? 'border-brand-primary'
												: 'border-transparent'}"
											class:line-through={cell.withdrawn}
											value={cell.value ?? ''}
											title={cell.flagged ? 'Flagged: excluded from the statistics' : undefined}
											onfocus={() => (focused = { row: rowIndex, column })}
											onpaste={(e) => onPaste(e, rowIndex, column)}
											oninput={(e) => setCell(rowIndex, column, e.currentTarget.value)}
										/>
									{/if}
								</td>
							{/each}
							<td class="px-2 py-1 text-brand-muted">{row.stats ? row.stats.n : '—'}</td>
							<td class="px-2 py-1 text-brand-muted">{fmt(row.stats?.mean)}</td>
							<td
								class="px-2 py-1 text-brand-muted"
								title={row.stats?.sd_estimator
									? `Standard deviation under the ${row.stats.sd_estimator} divisor`
									: undefined}>{fmt(row.stats?.stdev)}</td
							>
							<td class="px-2 py-1 text-brand-muted">{fmt(row.stats?.min)}</td>
							<td class="px-2 py-1 text-brand-muted">{fmt(row.stats?.max)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary" disabled={writes.length === 0} onclick={askToSave}>
				Save {writes.length || ''} {writes.length === 1 ? 'value' : 'values'}
			</Button>
			<Button disabled={writes.length === 0} onclick={reset}>Reset</Button>
			<Button variant="danger" onclick={askToWithdraw}>Withdraw this visit</Button>
			{#if withdrawnSetId}
				<Button loading={withdrawing} onclick={undoWithdrawal}>Undo the withdrawal</Button>
			{/if}
			{#if cleared.length > 0}
				<span class="text-sm text-brand-muted">
					{cleared.length} cleared cell{cleared.length === 1 ? '' : 's'} will not be saved:
					nothing here deletes, so a stored reading is withdrawn from its point record.
				</span>
			{/if}
		</div>
	{/if}
</div>

<Dialog bind:open={confirmOpen} title="Save this visit">
	<div class="space-y-2 text-sm">
		<p>
			{writes.length}
			{writes.length === 1 ? 'value' : 'values'} will be written:
			{writes.filter((w) => w.corrects).length} corrected in place,
			{writes.filter((w) => !w.corrects).length} entered.
		</p>
		{#if consequence}
			<p class="text-brand-muted">{consequence}</p>
		{:else if calculations.length === 0}
			<p class="text-brand-muted">No calculation reads what this save changes.</p>
		{/if}
	</div>
	{#snippet actions()}
		<Button onclick={() => (confirmOpen = false)}>Cancel</Button>
		<Button variant="primary" loading={saving} onclick={save}>Save</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={withdrawOpen} title="Withdraw this visit">
	<div class="space-y-2 text-sm">
		<p>
			{withdrawRows}
			{withdrawRows === 1 ? 'reading' : 'readings'} across this visit will be stamped withdrawn:
			excluded from serving, from the sample statistics, from alarms and from what a calculation
			reads. The visit itself stands, and nothing is deleted.
		</p>
		{#if consequence}
			<p class="text-brand-muted">{consequence}</p>
		{:else if calculations.length === 0}
			<p class="text-brand-muted">No calculation reads what this withdrawal covers.</p>
		{/if}
		<p class="text-brand-muted">It is one decision set, so one act puts it back.</p>
	</div>
	{#snippet actions()}
		<Button onclick={() => (withdrawOpen = false)}>Cancel</Button>
		<Button variant="danger" loading={withdrawing} onclick={withdrawVisit}>Withdraw</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={curveOpen} title="The curve this row was read against">
	<div class="space-y-2 text-sm">
		<p class="text-brand-muted">
			A curve applies to the values entered here, on top of the calibration the API resolves for
			the instrument. It does not re-correct a reading the visit already holds: that is a decision
			taken on the point record.
		</p>
		{#if curveRow !== null && detail && rows[curveRow]}
			<CurvePicker
				title={rows[curveRow].parameterName}
				bind:value={curveSelection}
				siteId={detail.site_id}
				parameterId={rows[curveRow].parameterId}
				parameterCode={rows[curveRow].parameterCode}
			/>
		{/if}
	</div>
	{#snippet actions()}
		<Button onclick={() => (curveOpen = false)}>Cancel</Button>
		<Button variant="primary" onclick={applyCurve}>Use this curve</Button>
	{/snippet}
</Dialog>
