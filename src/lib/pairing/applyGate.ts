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
