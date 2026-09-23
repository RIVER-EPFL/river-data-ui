/// The query a site export sends, built in one place so the file the operator receives is
/// decided by the dialog's own options rather than by the fetch that happens to run.

export type ExportFormat = 'csv' | 'json' | 'ndjson';
export type ExportResolution = 'raw' | 'hourly' | 'daily';
export type ExportMeasurementType = 'all' | 'continuous' | 'spot' | 'derived';

export interface ReadingsExportOptions {
	startMs: number;
	endMs: number;
	parameterIds: string[];
	format: ExportFormat;
	resolution: ExportResolution;
	includeFlagged: boolean;
	measurementType: ExportMeasurementType;
}

/// The statistics of a spot instant are the measurement: n, mean, sd, min and max are what the
/// portal published and what the whiskers on screen are drawn from, so a spot export carries them.
/// The replicates behind them are a row per replicate rather than per instant, and travel as their
/// own file.
export function wantsSampleStats(
	resolution: ExportResolution,
	measurementType: ExportMeasurementType
): boolean {
	return (
		resolution === 'raw' && (measurementType === 'spot' || measurementType === 'all')
	);
}

export function buildReadingsExportParams(opts: ReadingsExportOptions): URLSearchParams {
	const params = new URLSearchParams({
		start: new Date(opts.startMs).toISOString(),
		end: new Date(opts.endMs).toISOString(),
	});
	if (opts.parameterIds.length > 0) {
		params.set('parameter_ids', opts.parameterIds.join(','));
	}
	params.set('format', opts.format);
	if (opts.resolution !== 'raw') return params;

	params.set('include_flagged', String(opts.includeFlagged));
	// `include_flagged` decides whether flagged rows are in the file at all; `include_flags` is
	// what adds the columns saying which ones they are. The checkbox promises the metadata, so it
	// has to ask for both.
	if (opts.includeFlagged && opts.format !== 'json') {
		params.set('include_flags', 'true');
	}
	if (opts.measurementType !== 'all') {
		params.set('measurement_type', opts.measurementType);
	}
	if (wantsSampleStats(opts.resolution, opts.measurementType)) {
		params.set('include_sample_stats', 'true');
		// The curve a value was corrected with is what makes it reproducible months later.
		params.set('include_curves', 'true');
	}
	return params;
}

/// The columns the export will carry, in the order the API writes them, so the dialog can show the
/// file before it is downloaded. `codes` are the parameter codes selected for the export, which are
/// the value column names.
export function exportColumns(codes: string[], opts: ReadingsExportOptions): string[] {
	const columns = ['time', ...codes];
	if (opts.resolution !== 'raw') return columns;
	if (wantsSampleStats(opts.resolution, opts.measurementType)) {
		for (const code of codes) columns.push(`${code}_calibration_id`);
		for (const code of codes) columns.push(`${code}_standard_curve_id`);
		for (const code of codes) {
			columns.push(
				`${code}_sample_id`,
				`${code}_n`,
				`${code}_mean`,
				`${code}_sd`,
				`${code}_median`,
				`${code}_min`,
				`${code}_max`
			);
		}
	}
	if (opts.includeFlagged && opts.format !== 'json') {
		for (const code of codes) columns.push(`${code}_flagged`);
		for (const code of codes) columns.push(`${code}_flag_reason`);
	}
	if (opts.format !== 'json') {
		for (const code of codes) columns.push(`${code}_unverified`);
	}
	return columns;
}
