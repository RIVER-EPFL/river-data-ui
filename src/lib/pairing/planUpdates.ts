import type {
	PlanCurveUpdate,
	PlanEntryUpdate,
	PlanHeldCurveUpdate,
	PlanObjectUpdate,
	PlanProposalUpdate,
} from '$lib/api/service';

// Every decision the review queues is one of five shapes, and the PATCH carries them in five
// separate lists. The shapes have no discriminator of their own, so the key that only one of
// them has is the discriminator.
export type PlanUpdate =
	| PlanEntryUpdate
	| PlanCurveUpdate
	| PlanHeldCurveUpdate
	| PlanObjectUpdate
	| PlanProposalUpdate;

export interface SplitPlanUpdates {
	entries: PlanEntryUpdate[];
	curves: PlanCurveUpdate[];
	heldCurves: PlanHeldCurveUpdate[];
	objects: PlanObjectUpdate[];
	proposals: PlanProposalUpdate[];
}

export function splitPlanUpdates(batch: PlanUpdate[]): SplitPlanUpdates {
	return {
		entries: batch.filter((u): u is PlanEntryUpdate => 'stream_id' in u),
		curves: batch.filter((u): u is PlanCurveUpdate => 'curve_id' in u),
		heldCurves: batch.filter((u): u is PlanHeldCurveUpdate => 'proposal_id' in u),
		objects: batch.filter((u): u is PlanObjectUpdate => 'key' in u),
		proposals: batch.filter((u): u is PlanProposalUpdate => 'source_key' in u),
	};
}

// The plan's instrument view is keyed by parameter name and grouped by site, so a batch that moves
// either leaves it naming rows that no longer exist until it is fetched again.
export function movesPlanInstruments(batch: PlanUpdate[]): boolean {
	return batch.some((u) => 'stream_id' in u && (u.parameter_name != null || u.site_name != null));
}
