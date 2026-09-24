import type {
	EditOptionKind,
	InspectedRow,
	MovedRow,
	MovedSample,
	OverrideRequest,
} from '$api/service';

/** How an edit is offered: its label, what it changes, and what it deliberately does not. */
export interface EditMethod {
	label: string;
	/** The sentence under the option, in the imperative the surface uses elsewhere. */
	changes: string;
	/** What stays as it was. The half operators are surprised by, so it is always shown. */
	leaves: string;
	/** Whether the option is reversible by rolling its decision back. */
	reversible: boolean;
	/** The level a caller needs; the API refuses anything lower. */
	requires: 'write_data' | 'manage_sensors' | 'admin';
}

export const EDIT_METHODS: Record<EditOptionKind, EditMethod> = {
	reopen_run: {
		label: 'Reopen the calculation',
		changes:
			'Loads the run that produced this value with its own inputs, constants and curves. Editing an input and saving supersedes the stored outputs with fresh provenance.',
		leaves: 'Nothing changes until the run is saved again.',
		reversible: true,
		requires: 'write_data',
	},
	detach: {
		label: 'Detach from the calculation',
		changes:
			'Takes this output slot at this visit away from its calculation, so the value becomes one entered in the grid.',
		leaves:
			'The stored value stands. The calculation takes the slot back when an input at the visit changes, or when the slot is returned.',
		reversible: true,
		requires: 'admin',
	},
	return: {
		label: 'Return to the calculation',
		changes:
			'Gives this output slot back to its calculation and restores the value the calculation last produced.',
		leaves: 'The corrections made while it was detached stay in the record, rolled back rather than erased.',
		reversible: true,
		requires: 'admin',
	},
	override: {
		label: 'Override the calculated value',
		changes:
			'Replaces this one computed value with the number typed here and takes its slot at this visit off the calculation, so no later recompute writes over it.',
		leaves:
			'The run that computed the replaced value stays in the record, and the record names the value it gave. Return gives the slot back and restores it.',
		reversible: true,
		requires: 'admin',
	},
	value_correction: {
		label: 'Correct the value',
		changes:
			'Replaces the measurement and recomputes what stands on it: the corrected value, the group statistics, and any calculation that reads this parameter.',
		leaves:
			'The curve and the instrument the reading names are untouched: a correction corrects the measurement, not the correction.',
		reversible: true,
		requires: 'write_data',
	},
	curve: {
		label: 'Change the standard curve',
		changes: 'Records a different hand-picked curve and recomputes the corrected value from it.',
		leaves: 'The raw measurement is unchanged.',
		reversible: true,
		requires: 'manage_sensors',
	},
	edit_deployment: {
		label: 'Edit the deployment',
		changes:
			'The instrument here comes from the deployment history, so the fix belongs on the deployment: split it, or move its dates.',
		leaves: 'Nothing on this reading changes until the deployment does.',
		reversible: true,
		requires: 'manage_sensors',
	},
	edit_calibration: {
		label: 'Edit the calibration',
		changes:
			'The corrected value here comes from the calibration window covering it, so the fix belongs on the window: correct its coefficients, or move its dates.',
		leaves: 'Nothing on this reading changes until the calibration does.',
		reversible: true,
		requires: 'manage_sensors',
	},
	flag: {
		label: 'Flag',
		changes:
			'Excludes the reading from the group statistics, the rollups and the public API, and recomputes the group over what is left.',
		leaves: 'The value stays stored and visible here.',
		reversible: true,
		requires: 'write_data',
	},
	unflag: {
		label: 'Remove the flag',
		changes: 'Puts the reading back into the statistics and the rollups.',
		leaves: 'The value is unchanged.',
		reversible: true,
		requires: 'write_data',
	},
	withdraw: {
		label: 'Withdraw',
		changes:
			'Stamps the reading withdrawn, which takes it out of serving, the statistics, alarms and the seasonal check.',
		leaves: 'Nothing is deleted: the value stays and the stamp can be lifted.',
		reversible: true,
		requires: 'write_data',
	},
	reassert: {
		label: 'Reassert',
		changes: 'Lifts the withdrawal, so the reading is served again.',
		leaves: 'The value is unchanged.',
		reversible: true,
		requires: 'write_data',
	},
	verify: {
		label: 'Verify the entry',
		changes:
			'Accepts a pending entry as it stands, which puts it into the statistics, alarms and the public API.',
		leaves: 'The value is unchanged.',
		reversible: true,
		requires: 'write_data',
	},
	reject: {
		label: 'Reject the entry',
		changes: 'Withdraws a pending entry, which takes it out of serving.',
		leaves: 'Nothing is deleted: the value stays and a reassert restores it.',
		reversible: true,
		requires: 'write_data',
	},
};

/** The options that carry a value or a target rather than only a reason. */
export function needsValue(kind: EditOptionKind): boolean {
	return kind === 'value_correction';
}

export function needsTarget(kind: EditOptionKind): boolean {
	return kind === 'curve';
}

/** Options that are a route somewhere else rather than a decision this dialog commits. */
export function isRoute(kind: EditOptionKind): boolean {
	return kind === 'reopen_run' || kind === 'edit_deployment' || kind === 'edit_calibration';
}

/** Options recorded by their own route, which the edits preview refuses as not an edit. */
export function isDirect(kind: EditOptionKind): boolean {
	return kind === 'detach' || kind === 'return' || kind === 'override';
}

/** The override of one row, or null while the value is not yet a number. */
export function overrideBody(
	row: InspectedRow,
	value: string | number | null | undefined,
	reason: string,
): OverrideRequest | null {
	const typed = String(value ?? '').trim();
	const parsed = Number(typed);
	if (!row.site_id || !row.parameter_id || typed === '' || Number.isNaN(parsed)) return null;
	return {
		site_id: row.site_id,
		parameter_id: row.parameter_id,
		time: row.time,
		replicate_index: row.replicate_index,
		value: parsed,
		reason: reason || undefined,
	};
}

/** The slot instants a set of rows sits at, once each, which a detach or return names. */
export function outputSlots(
	rows: InspectedRow[],
): Array<{ site_id: string; parameter_id: string; time: string }> {
	const seen = new Map<string, { site_id: string; parameter_id: string; time: string }>();
	for (const r of rows) {
		if (!r.site_id || !r.parameter_id) continue;
		const key = `${r.site_id}|${r.parameter_id}|${r.time}`;
		if (!seen.has(key)) seen.set(key, { site_id: r.site_id, parameter_id: r.parameter_id, time: r.time });
	}
	return [...seen.values()];
}

/** The route a selection takes, from what the rows say. Mixed selections are named as such. */
export function selectionRoute(
	rows: InspectedRow[],
): 'tool' | 'detached' | 'manual' | 'mixed' | 'empty' {
	if (rows.length === 0) return 'empty';
	const detached = rows.filter((r) => r.provenance.slot_detached).length;
	const tool = rows.filter((r) => r.provenance.has_tool_run && !r.provenance.slot_detached).length;
	if (detached === rows.length) return 'detached';
	if (tool === rows.length) return 'tool';
	if (tool + detached === 0) return 'manual';
	return 'mixed';
}

/** The options every selected row permits, so the dialog never offers one that would be refused. */
export function commonOptions(rows: InspectedRow[]): EditOptionKind[] {
	if (rows.length === 0) return [];
	const [first, ...rest] = rows;
	return first.options.filter((option) => rest.every((row) => row.options.includes(option)));
}

/** One field of one row the preview moved: the pair worth showing, or null when it stood still. */
export interface MovedField {
	field: string;
	before: unknown;
	after: unknown;
}

const FIELD_LABEL: Record<string, string> = {
	raw_value: 'Value',
	calibrated_value: 'Corrected value',
	is_flagged: 'Flagged',
	flag_reason: 'Flag reason',
	withdrawn_at: 'Withdrawn',
	unverified: 'Pending review',
	standard_curve_id: 'Standard curve',
	calibration_id: 'Calibration',
	sensor_id: 'Instrument',
	mean: 'Mean',
	stdev: 'Standard deviation',
	n: 'Replicates counted',
	min_value: 'Minimum',
	max_value: 'Maximum',
};

export function fieldLabel(field: string): string {
	return FIELD_LABEL[field] ?? field;
}

/** Only the fields that actually moved, so the preview reads as a change rather than a dump. */
export function movedFields(before: Record<string, unknown>, after: Record<string, unknown>): MovedField[] {
	const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
	const moved: MovedField[] = [];
	for (const field of fields) {
		const a = before[field] ?? null;
		const b = after[field] ?? null;
		if (JSON.stringify(a) !== JSON.stringify(b)) moved.push({ field, before: a, after: b });
	}
	return moved.sort((x, y) => x.field.localeCompare(y.field));
}

/** Whether a preview would change anything at all; a no-op edit is worth saying so. */
export function previewIsEmpty(rows: MovedRow[], samples: MovedSample[]): boolean {
	const rowMoved = rows.some((r) => movedFields(r.before, r.after).length > 0);
	const sampleMoved = samples.some((s) => movedFields(s.before, s.after).length > 0);
	return !rowMoved && !sampleMoved;
}
