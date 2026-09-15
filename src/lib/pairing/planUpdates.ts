import type {
	PlanCurveUpdate,
	PlanEntryUpdate,
	PlanObjectUpdate,
	PlanProposalUpdate,
} from '$lib/api/service';

// Every decision the review queues is one of four shapes, and the PATCH carries them in four
// separate lists. The shapes have no discriminator of their own, so the key that only one of
// them has is the discriminator.
export type PlanUpdate = PlanEntryUpdate | PlanCurveUpdate | PlanObjectUpdate | PlanProposalUpdate;

export interface SplitPlanUpdates {
	entries: PlanEntryUpdate[];
	curves: PlanCurveUpdate[];
	objects: PlanObjectUpdate[];
	proposals: PlanProposalUpdate[];
}

export function splitPlanUpdates(batch: PlanUpdate[]): SplitPlanUpdates {
	return {
		entries: batch.filter((u): u is PlanEntryUpdate => 'stream_id' in u),
		curves: batch.filter((u): u is PlanCurveUpdate => 'curve_id' in u),
		objects: batch.filter((u): u is PlanObjectUpdate => 'key' in u),
		proposals: batch.filter((u): u is PlanProposalUpdate => 'source_key' in u),
	};
}
