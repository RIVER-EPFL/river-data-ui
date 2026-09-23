import type { Decommission, ProvenanceRecord } from '$api/service';
import { formatDate } from '$lib/utils';

/** The decommission of the calculation behind a record: its formula's, else its tool run's. */
export function recordDecommission(rec: Pick<ProvenanceRecord, 'calculation' | 'computation'>): Decommission | null {
	return rec.calculation?.decommissioned ?? rec.computation?.decommissioned ?? null;
}

/** The line a provenance view shows beside a decommissioned calculation's link. */
export function decommissionText(d: Decommission): string {
	return `Calculation decommissioned on ${formatDate(d.at)} by ${d.by}: ${d.reason}`;
}
