import type {
  PairingPlanEntry,
  PlanEntryUpdate,
  SdEstimator,
} from "$api/service";
import { selectedEntries, type Selection } from "./selection";

/**
 * One decision applied to every chosen row.
 *
 * The review's writes are per entry, and a first sync's rows are a handful of questions repeated
 * (B247), so an operator who can see and select the 400 rows waiting on one instrument still
 * answers them 400 times. This turns the selection plus one choice into the update list the plan
 * PATCH already takes, which is one request and one server transaction.
 */
export type BulkDecision =
  | { field: "action"; value: "pair" | "skip" }
  | { field: "acknowledged"; value: boolean }
  | { field: "sd_estimator"; value: SdEstimator | "" }
  | { field: "instrument_id"; value: string }
  | { field: "instrument_clear" };

/** Whether the row already reads the way the decision would leave it. */
function unchanged(entry: PairingPlanEntry, decision: BulkDecision): boolean {
  switch (decision.field) {
    case "action":
      return entry.action === decision.value;
    case "acknowledged":
      return (entry.acknowledged ?? false) === decision.value;
    case "sd_estimator":
      return (entry.sd_estimator ?? "") === decision.value;
    case "instrument_id":
      return entry.instrument?.id === decision.value;
    case "instrument_clear":
      return !entry.instrument;
  }
}

function update(
  entry: PairingPlanEntry,
  decision: BulkDecision,
): PlanEntryUpdate {
  const stream_id = entry.stream_id;
  switch (decision.field) {
    case "action":
      return { stream_id, action: decision.value };
    case "acknowledged":
      return { stream_id, acknowledged: decision.value };
    case "sd_estimator":
      return { stream_id, sd_estimator: decision.value };
    case "instrument_id":
      return { stream_id, instrument_id: decision.value };
    case "instrument_clear":
      return { stream_id, instrument_clear: true };
  }
}

/**
 * The updates one decision over one selection sends, in the order the plan lists its rows.
 *
 * Rows the decision would not move are left out: a bulk tick over 400 rows of which 350 are
 * already ticked is 50 updates, and sending the other 350 would bump the plan's version for
 * nothing and re-decide rows a person had already decided.
 */
export function bulkUpdates(
  entries: PairingPlanEntry[],
  selection: Selection,
  decision: BulkDecision,
): PlanEntryUpdate[] {
  return selectedEntries(selection, entries)
    .filter((entry) => !unchanged(entry, decision))
    .map((entry) => update(entry, decision));
}
