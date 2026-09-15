import type { ToolVersionUsage } from "$api/service";
import { formatCount } from "$lib/format";

// What a save or an activation does to the values already stored, stated before it is made. The
// arms are the API's `migrate_stored`: leave them on the version that produced them, or recompute
// them under the new one.

const LEDGER =
  "Recompute is a correction: every visit the replaced version produced values at is computed again under the new one, and each reading keeps a ledger row naming both versions and both values.";

const plural = (n: number, one: string) =>
  `${formatCount(n)} ${one}${n === 1 ? "" : "s"}`;

/** What a version holds, for a history row: the readings computed under it and where they sit. */
export function storedLabel(usage?: ToolVersionUsage): string {
  if (!usage) return "";
  if (usage.readings === 0) return "nothing stored";
  return `${plural(usage.readings, "reading")} at ${plural(usage.visits, "visit")}`;
}

/**
 * What the two arms do to the values the version standing now produced. Three states, because
 * "nothing stored" and "the counts have not arrived" are different claims.
 */
export function armConsequence(active?: ToolVersionUsage): string {
  if (!active) {
    return `A new version leaves every stored value on the version that produced it; later measurements use the new one. ${LEDGER}`;
  }
  if (active.readings === 0) {
    return `Version ${active.version_no} has produced nothing stored yet, so either arm leaves the record as it is.`;
  }
  return `Version ${active.version_no} produced ${storedLabel(active)}. A new version leaves them there and uses the new one from the next measurement. ${LEDGER}`;
}
