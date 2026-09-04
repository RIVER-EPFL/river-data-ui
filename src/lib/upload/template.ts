export type TemplateEntity = 'readings' | 'grab_samples' | 'status_events';
export type Template = { headers: string[]; rows: string[][] };

const EXAMPLE_TIME = '2026-01-15 10:30:00';

// Example rows for the long-format upload: one row per selected parameter at the chosen site,
// two replicate rows per parameter for grab samples. Names are the ones the mapping step matches.
export function templateRows(
	entity: TemplateEntity,
	site: { name: string } | null,
	params: { name: string }[],
): Template {
	const siteName = site?.name ?? 'Site name';
	const names = params.length > 0 ? params.map((p) => p.name) : ['Parameter name'];
	switch (entity) {
		case 'readings':
			return {
				headers: ['time', 'site', 'parameter', 'value', 'calibrated_value'],
				rows: names.map((p) => [EXAMPLE_TIME, siteName, p, '12.4', '']),
			};
		case 'grab_samples':
			return {
				headers: ['time', 'site', 'parameter', 'value'],
				rows: names.flatMap((p) => [
					[EXAMPLE_TIME, siteName, p, '12.4'],
					[EXAMPLE_TIME, siteName, p, '12.6'],
				]),
			};
		case 'status_events':
			return {
				headers: ['time', 'site', 'parameter', 'value'],
				rows: names.map((p) => [EXAMPLE_TIME, siteName, p, 'OK']),
			};
	}
}

function csvField(v: string): string {
	return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function templateCsv(t: Template): string {
	return [t.headers, ...t.rows].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
}
