import type { ProvenanceRecord } from '$api/service';
import type { SampleReplicate } from '$api/types';

/** The replicate group a provenance record holds, in the shape the flag dialog edits. */
export function replicatesOf(rec: ProvenanceRecord): SampleReplicate[] {
	return [...rec.readings]
		.sort((a, b) => a.replicate_index - b.replicate_index)
		.map((r) => ({
			replicate_index: r.replicate_index,
			raw_value: r.raw_value,
			calibrated_value: r.calibrated_value ?? null,
			calibration_id: r.calibration?.id ?? null,
			standard_curve_id: r.standard_curve?.id ?? null,
			flagged: r.is_flagged,
			withdrawn: r.withdrawn_at != null,
		}));
}
