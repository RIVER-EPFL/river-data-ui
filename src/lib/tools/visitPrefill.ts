import type { EventCell, ToolDescriptor } from '$api/service';
import type { StagedVisit } from '$lib/stores/visit.svelte';

/**
 * A tool form opened on a visit that already holds values (M4).
 *
 * The portal's tool reads the `(station, date, time)` row and renders the stored replicates into
 * the editable tables with the row's standard curve preselected. This is that, computed from the
 * visit's own cells rather than from a tool run, so it works for a portal-synced value, a
 * hand-entered grab and a plain CSV import as well as for a value a tool produced.
 *
 * The result is the `prefill` shape `initFormState` and `curveSelectionsFrom` take, so a caller
 * hands it to the same two functions a "reload into tool" navigation uses.
 */
export function prefillFromVisit(
	tool: Pick<ToolDescriptor, 'params' | 'event_inputs'>,
	cells: EventCell[],
): Record<string, unknown> {
	const byCode = new Map<string, EventCell>();
	const byId = new Map<string, EventCell>();
	for (const cell of cells) {
		byCode.set(cell.parameter_code.toLowerCase(), cell);
		byId.set(cell.parameter_id, cell);
	}
	const cellFor = (code?: string | null, id?: string | null): EventCell | undefined =>
		(id ? byId.get(id) : undefined) ?? (code ? byCode.get(code.toLowerCase()) : undefined);

	const prefill: Record<string, unknown> = {};

	// A replicates param is the measurement itself: its stored readings are the rows to open with,
	// in the source's own column order, with a gap left as a repeat that was not measured.
	for (const param of tool.params) {
		if (param.kind !== 'replicates') continue;
		const cell = cellFor(param.parameter_code, param.parameter?.id);
		if (!cell || cell.replicates.length === 0) continue;
		const highest = Math.max(...cell.replicates.map((r) => r.replicate_index));
		const values: (number | null)[] = Array.from({ length: highest + 1 }, () => null);
		for (const replicate of cell.replicates) {
			values[replicate.replicate_index] = replicate.raw_value;
		}
		prefill[param.name] = values;
		// The curve the stored replicates were corrected with, so a correction is one cell rather
		// than a re-pick. Replicates of one group share it; the lowest that names one settles it.
		const curveSlot = param.curve;
		if (curveSlot) {
			const stored = cell.replicates
				.slice()
				.sort((a, b) => a.replicate_index - b.replicate_index)
				.find((r) => r.standard_curve_id)?.standard_curve_id;
			if (stored) prefill[curveSlot] = stored;
		}
	}

	// A scalar the tool reads from the visit: the value the visit serves for that parameter. The
	// server resolves these at calculate time too, so this only puts them on screen.
	for (const input of tool.event_inputs ?? []) {
		if (input.param in prefill) continue;
		const cell = cellFor(input.parameter_code);
		if (cell?.served_value !== undefined && cell.served_value !== null) {
			prefill[input.param] = cell.served_value;
		}
	}

	return prefill;
}

/**
 * The run of `tool` this visit last saved, or null where it has never run here (Q192).
 *
 * The row header replays that run rather than opening on defaults, so a curve slot a scalar
 * formula declares comes back with the value the run chose. The id is read from the blob the
 * server stored on the measurement, which the visit detail serves verbatim.
 */
export function lastRunOfCalculation(tool: string, cells: EventCell[]): string | null {
	let latest: { id: string; at: string } | null = null;
	for (const cell of cells) {
		const blob = cell.record?.computation?.provenance as Record<string, unknown> | undefined;
		if (!blob || blob.tool !== tool) continue;
		const id = blob.run_id;
		if (typeof id !== 'string' || id.length === 0) continue;
		const at = typeof blob.saved_at === 'string' ? blob.saved_at : '';
		if (!latest || at > latest.at) latest = { id, at };
	}
	return latest?.id ?? null;
}

/** Which arm filled a tool form, read from the tools page URL (Q192). */
export type OpenedFrom = 'visit-last-run' | 'fresh';

/**
 * The row header replays the visit's last run, and the form says so, so a replayed curve and a
 * default are distinguishable to the person looking at the picker. The cell marker names the run
 * it reopened instead, and a first run says nothing.
 */
export function openedFrom(params: URLSearchParams): OpenedFrom {
	const replaying = params.get('reload') !== null && params.get('replay') === 'visit';
	return replaying ? 'visit-last-run' : 'fresh';
}

/** The visit a stored run was computed at, as its reload body names it. */
export interface RunVisit {
	siteId: string;
	collectedAt: string;
}

/** The reload body carries the run's context as `site_id` and `collected_at`; either missing is none. */
export function runVisit(body: Record<string, unknown>): RunVisit | null {
	const siteId = body.site_id;
	const collectedAt = body.collected_at;
	if (typeof siteId !== 'string' || typeof collectedAt !== 'string') return null;
	return { siteId, collectedAt };
}

export type ReopenStaging =
	| { action: 'keep' }
	| { action: 'stage'; visit: RunVisit; replaced: StagedVisit | null }
	| { action: 'clear'; replaced: StagedVisit };

/**
 * What reopening a run does to the staged visit. Data entry saves at the staged visit, so a run
 * reopened anywhere else would be saved at a visit it was never computed at.
 */
export function reopenStaging(run: RunVisit | null, staged: StagedVisit | null): ReopenStaging {
	if (!run) return staged ? { action: 'clear', replaced: staged } : { action: 'keep' };
	if (
		staged &&
		staged.siteId === run.siteId &&
		Date.parse(staged.collectedAt) === Date.parse(run.collectedAt)
	) {
		return { action: 'keep' };
	}
	return { action: 'stage', visit: run, replaced: staged };
}
