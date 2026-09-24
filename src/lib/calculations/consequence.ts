import type { ToolVersionUsage } from "$api/service";
import { formatCount } from "$lib/format";

// What a save or an activation does to the values already stored, stated before it is made.

const LEDGER =
  "each reading keeps a ledger row naming both versions and both values.";

const plural = (n: number, one: string) =>
  `${formatCount(n)} ${one}${n === 1 ? "" : "s"}`;

/** What a version holds, for a history row: the readings computed under it and where they sit. */
export function storedLabel(usage?: ToolVersionUsage): string {
  if (!usage) return "";
  if (usage.readings === 0) return "nothing stored";
  return `${plural(usage.readings, "reading")} at ${plural(usage.visits, "visit")}`;
}

/**
 * What a version change does to the values the version standing now produced. Three states,
 * because "nothing stored" and "the counts have not arrived" are different claims.
 */
export function versionConsequence(active?: ToolVersionUsage): string {
  if (!active) {
    return `Every value the replaced version produced is computed again under the new one, and ${LEDGER}`;
  }
  if (active.readings === 0) {
    return `Version ${active.version_no} has produced nothing stored yet, so nothing is recomputed.`;
  }
  return `Version ${active.version_no} produced ${storedLabel(active)}. They are computed again under the new one, and ${LEDGER}`;
}
