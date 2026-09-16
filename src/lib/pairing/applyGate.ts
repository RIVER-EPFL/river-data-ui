import { formatCount } from "$lib/format";

/**
 * Whether a plan may be applied, and what is holding it.
 *
 * Q133 chose the hard gate: a plan is applied once and rectifying it afterwards costs more than
 * reviewing it, so Apply waits until every row that poses a question has been answered. The rule
 * lives here rather than in the button's `disabled` expression so it can be stated once and
 * tested without a component.
 */
export interface ApplyGate {
  /** Entries that did not resolve, or carry a warning, and nobody has ticked. */
  needsChecking: number;
  /** Entries that resolved cleanly and nobody has ticked. A tick records that a person looked
   *  (Q155), so these wait too. */
  selfValidated: number;
  /** Instruments the plan would create that nobody has confirmed. */
  openInstrumentQuestions: number;
}

/**
 * Why Apply is refused, phrased for the operator, or `null` when it may run.
 *
 * The instrument question comes first: it is the narrower set and the one whose fix is a click on
 * the same screen, so naming it ahead of the review count sends the operator to the nearer of the
 * two.
 */
export function applyBlockedReason(gate: ApplyGate): string | null {
  if (gate.openInstrumentQuestions > 0) {
    const n = gate.openInstrumentQuestions;
    return `${n} instrument${n === 1 ? "" : "s"} still to decide; every parameter is paired with one`;
  }
  const n = gate.needsChecking + gate.selfValidated;
  if (n > 0) {
    return `${n} row${n === 1 ? "" : "s"} still to tick; a plan is applied once`;
  }
  return null;
}

/** Whether a gate item stops the apply, is worth knowing, or is settled. */
export type GateState = "blocking" | "advisory" | "done";

/** One line of the "Before you apply" strip: a count, a state, and where it is settled. */
export interface GateItem {
  key: "objects" | "instruments" | "rows" | "units";
  label: string;
  /** The count, phrased as progress where there is progress to make. */
  detail: string;
  state: GateState;
  /** The review tab that settles it. */
  tab: "objects" | "instruments" | "sites" | "parameters";
}

export interface PlanGate {
  objects: { accepted: number; total: number };
  instruments: { decided: number; total: number };
  rows: { ticked: number; total: number };
  /** Source parameters whose units disagree with the catalog entry they match. */
  unitConflicts: number;
}

/**
 * The gate as one list, blocking items first.
 *
 * An item with nothing behind it is left out rather than shown settled: a plan that creates no
 * object has no acceptance to report, and an advisory with a count of zero is not news.
 */
export function planGateItems(gate: PlanGate): GateItem[] {
  const items: GateItem[] = [];
  if (gate.objects.total > 0) {
    items.push({
      key: "objects",
      label: "Objects",
      detail: `${formatCount(gate.objects.accepted)} of ${formatCount(gate.objects.total)} accepted`,
      state: gate.objects.accepted >= gate.objects.total ? "done" : "blocking",
      tab: "objects",
    });
  }
  if (gate.instruments.total > 0) {
    items.push({
      key: "instruments",
      label: "Instruments",
      detail: `${formatCount(gate.instruments.decided)} of ${formatCount(gate.instruments.total)} decided`,
      state: gate.instruments.decided >= gate.instruments.total ? "done" : "blocking",
      tab: "instruments",
    });
  }
  if (gate.rows.total > 0) {
    items.push({
      key: "rows",
      label: "Rows",
      detail: `${formatCount(gate.rows.ticked)} of ${formatCount(gate.rows.total)} ticked`,
      state: gate.rows.ticked >= gate.rows.total ? "done" : "blocking",
      tab: "sites",
    });
  }
  if (gate.unitConflicts > 0) {
    items.push({
      key: "units",
      label: "Unit conflicts",
      detail: `${formatCount(gate.unitConflicts)} to settle`,
      state: "advisory",
      tab: "parameters",
    });
  }
  return items;
}

/** What the strip says is blocking, for the Apply button that reads the same list. */
export function gateBlocking(items: GateItem[]): GateItem[] {
  return items.filter((i) => i.state === "blocking");
}
