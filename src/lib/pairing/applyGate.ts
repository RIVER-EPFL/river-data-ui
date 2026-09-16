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
}

function reviewItem(tab: ReviewTab, label: string, p: Progress): GateItem {
  if (p.total === 0) return { tab, label, detail: "0", state: "none" };
  return {
    tab,
    label,
    detail: `${formatCount(p.reviewed)} of ${formatCount(p.total)} reviewed`,
    state: p.reviewed >= p.total ? "done" : "blocking",
  };
}

/**
 * The review's tab strip, each tab carrying its own review count, so the tabs are the checklist.
 *
 * Q133 chose the hard gate: a plan is applied once and rectifying it afterwards costs more than
 * reviewing it, so Apply waits until every tab with something to review is fully reviewed.
 */
export function planGateItems(gate: PlanGate): GateItem[] {
  return [
    reviewItem("projects", "Projects", gate.projects),
    reviewItem("sites", "Sites", gate.sites),
    reviewItem("parameters", "Parameters", gate.parameters),
    reviewItem("instruments", "Instruments", gate.instruments),
    reviewItem("curves", "Standard curves", gate.curves),
  ];
}

/** The tabs that stop the apply. */
export function gateBlocking(items: GateItem[]): GateItem[] {
  return items.filter((i) => i.state === "blocking");
}

/** Why Apply is refused, naming each tab still to review, or `null` when it may run. */
export function applyBlockedReason(items: GateItem[]): string | null {
  const blocking = gateBlocking(items);
  if (blocking.length === 0) return null;
  return `Still to review: ${blocking.map((i) => `${i.label} (${i.detail})`).join(", ")}`;
}
