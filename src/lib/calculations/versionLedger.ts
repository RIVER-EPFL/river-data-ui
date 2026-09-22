import type { VersionLedgerRow } from '$api/service';

/** A calculation's output, as the ledger links it. */
export interface LedgerOutput {
	parameterId: string;
	code: string;
}

/** One version's row, with the links a reader follows out of it. */
export interface LedgerLine {
	versionId: string;
	versionNo: number;
	readings: number;
	/** The span of instants the version wrote at, or null where it wrote nothing. */
	span: { from: string; to: string } | null;
	/** One link per output the calculation publishes, to its readings over that span. */
	links: Array<{ code: string; href: string }>;
}

/**
 * The readings a version produced for one output, listed over the span it wrote at. The readings
 * list is where a row opens its record, which is what makes it the destination: a ledger row is a
 * way into the values, not a page of its own.
 */
export function ledgerHref(
	base: string,
	parameterId: string,
	span: { from: string; to: string },
): string {
	const query = new URLSearchParams({
		parameter: parameterId,
		from: span.from,
		to: span.to,
	});
	return `${base}/readings?${query.toString()}`;
}

/**
 * The ledger as the page draws it. A version that wrote nothing keeps its row and carries no
 * links: "nothing stored" is an answer, not an empty list to hide.
 */
export function ledgerLines(
	rows: VersionLedgerRow[],
	outputs: LedgerOutput[],
	base: string,
): LedgerLine[] {
	return rows.map((row) => {
		const span =
			row.first_instant && row.last_instant
				? { from: row.first_instant, to: row.last_instant }
				: null;
		return {
			versionId: row.version_id,
			versionNo: row.version_no,
			readings: row.readings,
			span,
			links: span
				? outputs.map((o) => ({ code: o.code, href: ledgerHref(base, o.parameterId, span) }))
				: [],
		};
	});
}
