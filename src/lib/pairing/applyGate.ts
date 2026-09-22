import { formatCount } from "$lib/format";

import type { ReviewTab } from "./reviewTabs";

/** Whether a review tab stops the apply, is fully reviewed, or has nothing to review. */
export type GateState = "blocking" | "done" | "none";

/** One review tab as the gate reads it: its name, its count, and its state. */
export interface GateItem {
  tab: ReviewTab;
  label: string;
  /** The count, phrased as review progress where there is anything to review. */
  detail: string;
  state: GateState;
  /** What on this tab cannot be applied as it stands, each as a sentence naming the way out. */
  conflicts: string[];
}

export interface Progress {
  reviewed: number;
  total: number;
}

export interface PlanGate {
  projects: Progress;
  sites: Progress;
  parameters: Progress;
  instruments: Progress;
  curves: Progress;
  /**
   * What each tab holds that cannot be applied as it stands, as opposed to something still to
   * review. Reviewing a row does not clear one: the code or the name has to change.
   */
  conflicts?: Partial<Record<ReviewTab, string[]>>;
}

function reviewItem(tab: ReviewTab, label: string, p: Progress, conflicts: string[]): GateItem {
  if (conflicts.length > 0) {
    return {
      tab,
      label,
      detail: `${formatCount(conflicts.length)} to resolve`,
      state: "blocking",
      conflicts,
    };
  }
  if (p.total === 0) return { tab, label, detail: "0", state: "none", conflicts };
  return {
    tab,
    label,
    detail: `${formatCount(p.reviewed)} of ${formatCount(p.total)} reviewed`,
    state: p.reviewed >= p.total ? "done" : "blocking",
    conflicts,
  };
}

/**
 * The review's tab strip, each tab carrying its own review count, so the tabs are the checklist.
 *
 * Q133 chose the hard gate: a plan is applied once and rectifying it afterwards costs more than
 * reviewing it, so Apply waits until every tab with something to review is fully reviewed.
 */
export function planGateItems(gate: PlanGate): GateItem[] {
  const held = (tab: ReviewTab) => gate.conflicts?.[tab] ?? [];
  return [
    reviewItem("projects", "Projects", gate.projects, held("projects")),
    reviewItem("sites", "Sites", gate.sites, held("sites")),
    reviewItem("parameters", "Parameters", gate.parameters, held("parameters")),
    reviewItem("instruments", "Instruments", gate.instruments, held("instruments")),
    reviewItem("curves", "Standard curves", gate.curves, held("curves")),
  ];
}

/** The tabs that stop the apply. */
export function gateBlocking(items: GateItem[]): GateItem[] {
  return items.filter((i) => i.state === "blocking");
}

/**
 * Why Apply is refused, or `null` when it may run. A conflict is named in full, because reviewing
 * the row does not clear it; anything else is a review count.
 */
export function applyBlockedReason(items: GateItem[]): string | null {
  const conflicts = items.flatMap((i) => i.conflicts);
  if (conflicts.length > 0) return `To resolve first: ${conflicts.join(" ")}`;
  const blocking = gateBlocking(items);
  if (blocking.length === 0) return null;
  return `Still to review: ${blocking.map((i) => `${i.label} (${i.detail})`).join(", ")}`;
}
