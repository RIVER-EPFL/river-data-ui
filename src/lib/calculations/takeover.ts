import type { Takeover } from '$api/service';

/** The confirm's line for one column a save would take over (Q299). */
export function takeoverLine(t: Takeover, date: (iso: string) => string): string {
	const held =
		t.readings === 0
			? 'holds no readings yet'
			: `holds ${t.readings} reading${t.readings === 1 ? '' : 's'}` +
				(t.first_reading && t.last_reading ? ` from ${date(t.first_reading)} to ${date(t.last_reading)}` : '') +
				(t.source_systems.length > 0 ? ` (${t.source_systems.join(', ')})` : '');
	const by =
		t.kind === 'decommissioned'
			? `the decommissioned calculation ${t.computed_by}`
			: `the portal's ${t.computed_by}`;
	const units = t.units.trim() ? `its units, ${t.units}` : 'no units';
	return (
		`${t.code} ${held}, computed by ${by}. ` +
		`Saving continues that series under this calculation; the column keeps its name, ${t.parameter_name}, and ${units}.`
	);
}
