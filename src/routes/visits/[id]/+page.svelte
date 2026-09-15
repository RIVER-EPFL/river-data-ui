<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import {
		commitEdit,
		getCalculationClosure,
		getCollectionEventDetail,
		previewEdit,
		rollbackEditSet,
		listSiteVisits,
		saveGrabSample,
		type CalculationImpact,
		type EventDetailResponse,
	} from '$api/service';
	import {
		applyPaste,
		clearedCells,
		entryGroups,
		gridFromVisit,
		pendingWrites,
		rowsInGroup,
		seedReplicateCounts,
		setReplicateCount,
		stagedVisitFrom,
		touchedParameters,
		headerCount,
		isEditable,
		setCellValue,
		withConfiguredRows,
		type ConfiguredParameter,
		type GridRow,
	} from '$lib/visits/grid';
	import { at, covers, isGridKey, move, type Selection } from '$lib/visits/keys';
	import { push, undo, type History } from '$lib/visits/history';
	import { api, type ParameterGroup, type Sensor } from '$api/crud';
	import { goto } from '$app/navigation';
	import { stagedVisit } from '$lib/stores/visit.svelte';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { curveCountLabel } from '$lib/standardCurves';
	import { me } from '$auth/me.svelte';
	import { cellRecord, recordMarkerTitle } from '$lib/visits/cell';
	import { cellWritable, editConsequence } from '$lib/visits/role';
	import { RECOMPUTE_BADGE, computing } from '$lib/visits/recompute';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import PointInspector from '$components/provenance/PointInspector.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// The visit as the portal's Database grid, filtered to one date (M50, orientation from I18):
	// parameters down, replicates across, the statistics the trigger maintains beside them. A
	// value a calculation writes is read-only here; it is changed by changing what it reads.
	const eventId = $derived(page.params.id ?? '');

	let detail = $state<EventDetailResponse | null>(null);
	let rows = $state<GridRow[]>([]);
	let sensors = $state<Sensor[]>([]);
	/** What each slot declares measures it (M111), the default a row takes. */
	let slotInstruments = $state<Record<string, string>>({});
	let loading = $state(true);
	let error = $state('');
	let saving = $state(false);
	let confirmOpen = $state(false);
	let consequence = $state<string | null>(null);
	let calculations = $state<CalculationImpact[]>([]);
	let focused = $state<Selection | null>(null);
	// What the grid held before each edit, so one mistyped cell costs the cell and not the block.
	let history = $state<History<GridRow[]>>([]);
	let configured = $state<ConfiguredParameter[]>([]);
	/** The group each parameter belongs to, and the groups themselves, for the grid's filter. */
	let groups = $state<ParameterGroup[]>([]);
	let groupOf = $state<Record<string, string>>({});
	let groupFilter = $state('');
	// The visit's retraction: what withdrawing it would cover, and the set that undoes it.
	let withdrawOpen = $state(false);
	let withdrawing = $state(false);
	let withdrawPreviewId = $state('');
	let withdrawRows = $state(0);
	let withdrawnSetId = $state('');
	// The row whose record is open under the grid. The detail already carries it, so nothing is
	// fetched: the marker hands PointInspector what the cell was drawn from.
	let inspecting = $state<GridRow | null>(null);
	// How each slot serves its values, for the record's own columns.
	let slotDisplay = $state<Record<string, { units?: string; decimals?: number }>>({});

	const width = $derived(headerCount(rows));
	const shown = $derived(new Set(rowsInGroup(rows, groupOf, groupFilter).map((r) => r.parameterId)));
	const writes = $derived(pendingWrites(rows));

	/** How long the grid follows a visit's calculations before leaving it to the next read. */
	const RECOMPUTE_POLL_MS = 400;
	const RECOMPUTE_POLL_ATTEMPTS = 50;
	const cleared = $derived(clearedCells(rows));

	$effect(() => {
		const id = eventId;
		if (!id) return;
		loading = true;
		getCollectionEventDetail(id)
			.then((d) => {
				detail = d;
				rows = gridFromVisit(d);
				// The Curve column names what corrected the stored values, so the rows' curves
				// are resolved for their labels.
				curveRefs.ensureStandardCurves(rows.map((r) => r.standardCurveId));
				error = '';
			})
			.then(() => loadConfigured(detail!.site_id))
			.catch((e) => (error = e instanceof Error ? e.message : 'Could not load the visit'))
			.finally(() => (loading = false));
	});

	/**
	 * The site's own sheet: every parameter it is assigned, the group each belongs to, and how wide
	 * each row opens (Q61). The visit's stored values are already on the grid; this is what the
	 * site adds around them.
	 */
	async function loadConfigured(siteId: string) {
		const [slots, catalog, instruments, groupRows, members] = await Promise.all([
			api.siteParameters.list({ perPage: 500, filter: { site_id: siteId } }),
			api.parameters.list({ perPage: 1000, sort: ['code', 'ASC'] }),
			api.sensors.list({ perPage: 200, sort: ['name', 'ASC'] }),
			api.parameterGroups.list({ perPage: 200, sort: ['ordinal', 'ASC'] }),
			api.parameterGroupMembers.list({ perPage: 1000 }),
		]);
		groups = groupRows.data;
		groupOf = Object.fromEntries(members.data.map((m) => [m.parameter_id, m.group_id]));
		sensors = instruments.data;
		// What each slot declares measures it, which is what a row with nothing stored takes.
		slotInstruments = Object.fromEntries(
			slots.data
				.filter((slot) => slot.instrument_sensor_id)
				.map((slot) => [slot.parameter_id, slot.instrument_sensor_id as string]),
		);
		rows = rows.map((r) =>
			r.sensorId ? r : { ...r, sensorId: slotInstruments[r.parameterId] },
		);
		curveRefs.ensureCurveCounts(rows.map((r) => r.sensorId));
		const byId = new Map(catalog.data.map((p) => [p.id, p]));
		slotDisplay = Object.fromEntries(
			slots.data.map((slot) => [
				slot.parameter_id,
				{ units: slot.display_units ?? undefined, decimals: slot.decimal_places ?? undefined },
			]),
		);
		configured = slots.data
			.filter((slot) => slot.entry_mode !== 'tool' && byId.has(slot.parameter_id))
			.map((slot) => {
				const parameter = byId.get(slot.parameter_id)!;
				return {
					parameterId: parameter.id,
					code: parameter.code,
					name: slot.name ?? parameter.name ?? parameter.code,
				};
			})
			.sort((a, b) => a.code.localeCompare(b.code));
		rows = seedReplicateCounts(withConfiguredRows(rows, configured), await priorWidths(siteId));
	}

	/**
	 * How many repeats the site last recorded for each parameter, from its most recent visits. A
	 * parameter with no history is absent, which opens its row one cell wide.
	 */
	async function priorWidths(siteId: string): Promise<Record<string, number>> {
		try {
			const visits = await listSiteVisits(siteId, { page: 1, page_size: 10 });
			const widths: Record<string, number> = {};
			// Newest first, so the first visit holding a parameter is the one that answers for it.
			for (const visit of visits.visits) {
				for (const cell of visit.cells) {
					if (cell.n_total > 0 && !(cell.parameter_id in widths)) {
						widths[cell.parameter_id] = cell.n_total;
					}
				}
			}
			return widths;
		} catch {
			// Without the history every row opens one cell wide, which is what it did before.
			return {};
		}
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

	function setRowReplicates(rowIndex: number, count: number) {
		remember();
		rows = setReplicateCount(rows, rowIndex, count);
	}

	// Record what the grid holds before changing it. Every edit replaces `rows` wholesale, so the
	// value being replaced is the snapshot.
	function remember() {
		history = push(history, rows);
	}

	function undoEdit() {
		const previous = undo(history);
		if (!previous) return;
		history = previous.history;
		rows = previous.value;
	}

	function declareRowInstrument(rowIndex: number, sensorId: string) {
		rows = rows.map((r, i) => (i === rowIndex ? { ...r, sensorId: sensorId || undefined } : r));
		curveRefs.ensureCurveCounts([sensorId]);
	}

	function setCell(rowIndex: number, column: number, raw: string) {
		const text = raw.trim();
		const parsed = text === '' ? null : Number(text);
		if (parsed !== null && Number.isNaN(parsed)) return;
		remember();
		rows = setCellValue(rows, rowIndex, column, parsed);
	}

	// Move the keyboard between cells rather than inside one. The destination input is focused by
	// the id the markup gives it, which is what makes the roving focus a real focus.
	function onCellKey(event: KeyboardEvent, rowIndex: number, column: number) {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			undoEdit();
			return;
		}
		if (!isGridKey(event.key)) return;
		const from = focused ?? at(rowIndex, column);
		const next = move({ ...from, row: rowIndex, column }, event.key, { rows: rows.length, columns: width }, event.shiftKey);
		if (!next) return;
		event.preventDefault();
		focused = next;
		document.getElementById(`cell-${next.row}-${next.column}`)?.focus();
	}

	function onPaste(event: ClipboardEvent, rowIndex: number, column: number) {
		const text = event.clipboardData?.getData('text/plain') ?? '';
		if (!text.includes('\t') && !text.includes('\n')) return;
		event.preventDefault();
		remember();
		rows = applyPaste(rows, rowIndex, column, text);
	}

	function reset() {
		if (!detail) return;
		remember();
		rows = gridFromVisit(detail);
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
			// One decision over every corrected cell: the values differ per key, so they travel on
			// the keys. A pasted block is then one set to roll back rather than one per cell, and
			// a failure part-way leaves nothing half corrected.
			const corrections = writes.filter((w) => w.corrects);
			if (corrections.length > 0) {
				const selection = {
					keys: corrections.map((w) => ({
						stream_id: w.streamId,
						time: visit.collected_at,
						replicate_index: w.replicateIndex,
						value: w.value,
					})),
				};
				const decision = {
					kind: 'value_correction' as const,
					reason: 'corrected in the visit grid',
				};
				const preview = await previewEdit(selection, decision);
				await commitEdit(selection, decision, preview.preview_id);
			}
			// The whole group, not only the new cells: a replace rewrites what the request names.
			const entries = entryGroups(rows);
			let kept = 0;
			if (entries.length > 0) {
				const readings = [];
				for (const w of entries) {
					readings.push({
						parameter_id: w.parameterId,
						value: w.value,
						time: visit.collected_at,
						replicate_index: w.replicateIndex,
						...(w.sensorId ? { sensor_id: w.sensorId } : {}),
					});
				}
				kept = (await saveGrabSample({ site_id: visit.site_id, mode: 'replace', readings }))
					.kept_curated;
			}
			const saved = `${writes.length} value${writes.length === 1 ? '' : 's'} saved`;
			if (kept) {
				toastStore.info(
					`${saved}. ${kept} curated value${kept === 1 ? ' was' : 's were'} kept, so what you entered there was not written.`,
				);
			} else {
				toastStore.success(saved);
			}
			confirmOpen = false;
			await refreshWhileComputing();
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
		rows = gridFromVisit(fresh);
	}

	/**
	 * Read the visit until its calculations have finished writing.
	 *
	 * The chain is a tracked job, so a write returns before the outputs it triggers are in the
	 * store and one read of the visit shows the numbers the save replaced. The visit reports its
	 * own state, so the grid follows that rather than a fixed wait. A cell typed while it runs
	 * stops the polling: what the person is holding is not thrown away to show a computed value.
	 */
	async function refreshWhileComputing() {
		await refresh();
		for (let attempt = 0; attempt < RECOMPUTE_POLL_ATTEMPTS; attempt++) {
			if (!computing(detail?.recompute) || writes.length > 0) return;
			await new Promise((resolve) => setTimeout(resolve, RECOMPUTE_POLL_MS));
			await refresh();
		}
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
			await refreshWhileComputing();
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
			await refreshWhileComputing();
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
			<div class="flex items-center gap-2">
				{#if RECOMPUTE_BADGE[detail.recompute]}
					<Badge variant={RECOMPUTE_BADGE[detail.recompute].variant}
						>{RECOMPUTE_BADGE[detail.recompute].label}</Badge
					>
				{/if}
				<a class="text-sm text-brand-primary hover:underline" href="{base}/sites/{detail.site_id}?tab=visits&event={detail.id}"
					>Back to the site</a
				>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2 text-sm">
			<span class="text-brand-muted">
				Each row opens as wide as the site last recorded that parameter; − and + change its
				repeat count, and a stored repeat is never dropped by the minus. Paste a spreadsheet
				block into any cell and it fills rightward and downward, where a blank cell stays a
				gap.
			</span>
		</div>

		<div class="flex flex-wrap items-center gap-2 text-sm">
			<label for="group-filter">Parameter group</label>
			<select
				id="group-filter"
				bind:value={groupFilter}
				class="rounded-md border border-brand-divider bg-brand-surface px-2 py-1"
				title="Narrow the sheet to one group. Every parameter the site is assigned is on the grid either way."
			>
				<option value="">All groups</option>
				{#each groups as group (group.id)}
					<option value={group.id}>{group.label}</option>
				{/each}
				<option value="none">Ungrouped</option>
			</select>
			<span class="text-brand-muted">{shown.size} of {rows.length} parameters</span>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<thead>
					<tr class="text-left text-xs uppercase tracking-wide text-gray-500">
						<th class="px-2 py-1">Parameter</th>
						<th class="px-2 py-1">Instrument</th>
						<th class="px-2 py-1">Curve</th>
						{#each Array.from({ length: width }, (_, i) => i) as column (column)}
							<th class="px-2 py-1">Rep {column + 1}</th>
						{/each}
						<th class="px-2 py-1">Repeats</th>
						<th class="px-2 py-1">n</th>
						<th class="px-2 py-1">Mean</th>
						<th class="px-2 py-1">SD</th>
						<th class="px-2 py-1">Min</th>
						<th class="px-2 py-1">Max</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, rowIndex (row.parameterId)}
						{#if shown.has(row.parameterId)}
						<tr class="border-t border-gray-100 dark:border-gray-800">
							<th
								scope="row"
								class="px-2 py-1 text-left font-medium {row.roleClass}"
								title={row.roleTitle ?? undefined}
							>
								{row.parameterName}
								{#if row.record}
									<button
										type="button"
										class="ml-1 rounded px-1 text-xs text-brand-primary hover:underline"
										title={recordMarkerTitle(row)}
										aria-label="What produced {row.parameterName}"
										data-testid="provenance-marker"
										onclick={() =>
											(inspecting = inspecting?.parameterId === row.parameterId ? null : row)}
									>&#9432;</button>
								{/if}
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
									<select
										class="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-brand-divider"
										title="What measured this row. It defaults to what the site declares for this parameter and is stored on every value the row enters."
										aria-label="Instrument for {row.parameterName}"
										value={row.sensorId ?? ''}
										onchange={(e) => declareRowInstrument(rowIndex, e.currentTarget.value)}
									>
										<option value="">Undeclared</option>
										{#each sensors as sensor}
											<option value={sensor.id}>{sensor.name ?? sensor.serial_number ?? sensor.id.slice(0, 8)}</option>
										{/each}
									</select>
									{#if row.sensorId}
										{@const curveCount = curveRefs.curveCount(row.sensorId)}
										<a
											class="block text-[11px] no-underline hover:underline {curveCount === 0
												? 'text-severity-warning'
												: 'text-brand-muted'}"
											href="{base}/sensors/{row.sensorId}?tab=curves"
											title="The standard curves this instrument holds. A value entered here is corrected with one chosen in the tool that computes it, never in the grid."
										>{curveCountLabel(curveCount)}</a>
									{/if}
								{/if}
							</td>
							<td class="px-2 py-1">
								{#if row.standardCurveId}
									{@const curveTool = row.writtenBy ?? row.tool}
									{@const sensorId = curveRefs.standardCurveSensorId(row.standardCurveId)}
									{#if curveTool}
										<button
											type="button"
											class="text-brand-primary hover:underline"
											title="The curve the stored values were corrected with. It is chosen in {curveTool}, which is where its uses are seen, never here."
											onclick={() => openCalculation(curveTool)}
										>{curveRefs.standardCurveLabel(row.standardCurveId)}</button>
									{:else if sensorId}
										<a
											class="text-brand-primary hover:underline"
											href="{base}/sensors/{sensorId}?tab=curves"
											title="The curve the stored values were corrected with. No calculation wrote this row, so the instrument holding the curve is where it is read."
										>{curveRefs.standardCurveLabel(row.standardCurveId)}</a>
									{:else}
										<span title="The curve the stored values were corrected with. A curve is chosen in the tool that computes with it, never here."
											>{curveRefs.standardCurveLabel(row.standardCurveId)}</span>
									{/if}
								{:else}
									<span class="text-brand-muted">—</span>
								{/if}
							</td>
							{#each Array.from({ length: width }, (_, i) => i) as column (column)}
								{@const cell = row.replicates[column]}
								{@const entry = cellWritable(me.level, cell?.stored ?? null)}
								<td class="px-1 py-1">
									{#if row.writtenBy}
										<span class="px-1 text-brand-muted">{cell?.value ?? '—'}</span>
									{:else if !isEditable(row, column)}
										<span class="px-1"></span>
									{:else if !entry.writable}
										<span class="px-1 text-brand-muted" title={entry.reason ?? undefined}
											>{cell?.value ?? '—'}</span
										>
									{:else}
										<input
											id="cell-{rowIndex}-{column}"
											data-testid="grid-cell-{rowIndex}-{column}"
											class="w-20 rounded border px-1 py-0.5 {cell && cell.value !== cell.stored
												? 'border-brand-primary'
												: 'border-transparent'}"
											class:line-through={cell?.withdrawn}
											class:bg-brand-bg={focused
												? covers(focused, rowIndex, column)
												: false}
											value={cell?.value ?? ''}
											title={cell?.flagged ? 'Flagged: excluded from the statistics' : undefined}
											onfocus={() => (focused = at(rowIndex, column))}
											onkeydown={(e) => onCellKey(e, rowIndex, column)}
											onpaste={(e) => onPaste(e, rowIndex, column)}
											oninput={(e) => setCell(rowIndex, column, e.currentTarget.value)}
										/>
									{/if}
								</td>
							{/each}
							<td class="px-2 py-1 whitespace-nowrap">
								{#if row.writtenBy}
									<span class="text-brand-muted">—</span>
								{:else}
									<button
										type="button"
										class="rounded border border-brand-divider px-1.5 leading-none"
										title="One repeat fewer. A repeat the store holds is not dropped here: that is a flag or a withdrawal."
										aria-label="One repeat fewer for {row.parameterName}"
										onclick={() => setRowReplicates(rowIndex, row.replicates.length - 1)}
									>&minus;</button>
									<span class="px-1 text-brand-muted">{row.replicates.length}</span>
									<button
										type="button"
										class="rounded border border-brand-divider px-1.5 leading-none"
										title="One repeat more"
										aria-label="One repeat more for {row.parameterName}"
										onclick={() => setRowReplicates(rowIndex, row.replicates.length + 1)}
									>&plus;</button>
								{/if}
							</td>
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
						{#if inspecting?.parameterId === row.parameterId && detail}
							<tr class="border-t border-gray-100 dark:border-gray-800">
								<td colspan={width + 9} class="px-2 py-2">
									<PointInspector
										siteId={detail.site_id}
										parameterId={row.parameterId}
										parameterName={row.parameterName}
										units={slotDisplay[row.parameterId]?.units ?? null}
										decimals={slotDisplay[row.parameterId]?.decimals ?? null}
										timeIso={detail.collected_at}
										measurementType="spot"
										preloaded={cellRecord(detail, row.parameterId)}
										onclose={() => (inspecting = null)}
									/>
								</td>
							</tr>
						{/if}
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		{#if me.level > 0 && me.level < 2}
			<p class="text-sm text-brand-muted">
				You may enter measurements here. A cell that already holds a value is a manager's to
				change, so it is shown rather than offered, and what you save is marked unverified until
				a manager rules on it.
			</p>
		{:else if me.level === 0}
			<p class="text-sm text-brand-muted">
				Your account holds no level that may enter data, so this visit is read-only.
			</p>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<Button variant="primary" disabled={writes.length === 0} onclick={askToSave}>
				Save {writes.length || ''} {writes.length === 1 ? 'value' : 'values'}
			</Button>
			<Button disabled={history.length === 0} onclick={undoEdit} title="Undo the last edit (Ctrl+Z)"
				>Undo</Button
			>
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

