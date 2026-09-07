// Which instrument a saved row says measured it (M128).
//
// Three sources, most specific first: the curve's own instrument where a standard curve corrected
// the row, then the operator's declaration for that row, then nothing, which leaves the server to
// resolve what the slot declares. Sending the slot's own declaration back would be attribution
// travelling on the request, which is the pairing's job, so an untouched row sends none.

export interface RowInstrumentInputs {
	/** The standard curve applied to this row, if any. */
	curveId: string | null;
	/** The instrument that curve was fitted on. */
	curveInstrumentId: string | null;
	/** What the operator chose for this row, empty where they chose nothing. */
	declared: string | null;
}

/** The `sensor_id` a reading of this row carries, or null to leave it to the server. */
export function readingInstrument({
	curveId,
	curveInstrumentId,
	declared,
}: RowInstrumentInputs): string | null {
	if (curveId && curveInstrumentId) return curveInstrumentId;
	return declared && declared !== '' ? declared : null;
}

/**
 * Whether the row's instrument is the operator's to choose. A curve belongs to the instrument it
 * was fitted on, and the server refuses a reading pairing one with another, so a corrected row
 * shows the curve's instrument rather than offering a choice that would be refused.
 */
export function instrumentIsChoosable(
	curveId: string | null,
	curveInstrumentId: string | null,
): boolean {
	return !(curveId && curveInstrumentId);
}
