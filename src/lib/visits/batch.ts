// The field day as one block: rows are (site, collected_at), columns are parameter x replicate
// (M51, shape decided by Q42). The lab pastes its sheet, names its columns once, and each visit is
// staged and saved on its own, so a station the Check refuses leaves its neighbours saved.

/** One column of the pasted block, and what the operator says it holds. */
export type ColumnRole =
	| { kind: 'ignored' }
	| { kind: 'site' }
	| { kind: 'collected_at' }
	| { kind: 'value'; parameterId: string; replicateIndex: number };

export interface Layout {
	/** One role per column, in the block's column order. */
	columns: ColumnRole[];
}

export interface ParameterColumn {
	parameterId: string;
	code: string;
	name: string;
}

/** A pasted spreadsheet block as a rectangle of cells, header row included. */
export function parseBlock(text: string): string[][] {
	const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
	const cells = lines.filter((l) => l.trim() !== '').map((l) => l.split('\t'));
	const widest = cells.reduce((m, r) => Math.max(m, r.length), 0);
	return cells.map((row) => {
		const padded = row.slice();
		while (padded.length < widest) padded.push('');
		return padded.map((c) => c.trim());
	});
}

const SITE_HEADERS = ['site', 'station', 'site_name', 'station_name'];
const TIME_HEADERS = ['date', 'time', 'collected_at', 'datetime', 'timestamp'];

/**
 * The layout a header row implies: the lab's own column names, read against the parameter catalog.
 *
 * `{code}_rep_N` and `{code}_N` are replicate N (1-based in the sheet, 0-based on the reading);
 * a bare `{code}` is the first replicate. A statistics column (`_avg`, `_sd`, `_mean`, `_stdev`)
 * is ignored on purpose: statistics are computed from the replicates, never stored from a sheet.
 */
export function inferLayout(headers: string[], parameters: ParameterColumn[]): Layout {
	const byCode = new Map(parameters.map((p) => [p.code.toLowerCase(), p]));
	const columns = headers.map((header): ColumnRole => {
		const name = header.trim().toLowerCase();
		if (name === '') return { kind: 'ignored' };
		if (SITE_HEADERS.includes(name)) return { kind: 'site' };
		if (TIME_HEADERS.includes(name)) return { kind: 'collected_at' };
		const replicate = name.match(/^(.*?)_(?:rep_?)?(\d+)$/);
		const base = replicate ? replicate[1] : name;
		const stats = base.match(/^(.*?)_(avg|mean|sd|stdev|stddev|n)$/);
		if (stats && byCode.has(stats[1])) return { kind: 'ignored' };
		const parameter = byCode.get(base);
		if (!parameter) return { kind: 'ignored' };
		return {
			kind: 'value',
			parameterId: parameter.parameterId,
			replicateIndex: replicate ? Math.max(0, Number(replicate[2]) - 1) : 0,
		};
	});
	return { columns };
}

export interface BatchValue {
	parameterId: string;
	replicateIndex: number;
	value: number;
}

export interface BatchVisit {
	/** The site cell as it was pasted, kept for the row that could not be resolved. */
	site: string;
	siteId: string | null;
	collectedAt: string | null;
	values: BatchValue[];
	/** What stops this row being saved, said in the operator's terms. */
	problem: string | null;
}

export interface SiteChoice {
	id: string;
	name: string;
}

/** An ISO instant from a sheet cell: an ISO stamp as typed, or a bare date at midnight UTC. */
export function readInstant(cell: string): string | null {
	const text = cell.trim();
	if (text === '') return null;
	const bare = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	const iso = bare ? `${text}T00:00:00Z` : text;
	const parsed = Date.parse(iso);
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** The visits a block describes under a layout, one per data row, in the order they were pasted. */
export function batchVisits(block: string[][], layout: Layout, sites: SiteChoice[]): BatchVisit[] {
	const byName = new Map(sites.map((s) => [s.name.trim().toLowerCase(), s.id]));
	const byId = new Set(sites.map((s) => s.id));
	return block.slice(1).map((row) => {
		let site = '';
		let collectedAt: string | null = null;
		const values: BatchValue[] = [];
		layout.columns.forEach((role, column) => {
			const cell = row[column] ?? '';
			if (role.kind === 'site') site = cell;
			else if (role.kind === 'collected_at') collectedAt = readInstant(cell);
			else if (role.kind === 'value') {
				if (cell === '') return;
				const value = Number(cell);
				if (Number.isNaN(value)) return;
				values.push({
					parameterId: role.parameterId,
					replicateIndex: role.replicateIndex,
					value,
				});
			}
		});
		const siteId = byId.has(site) ? site : (byName.get(site.trim().toLowerCase()) ?? null);
		const problem =
			siteId === null
				? site === ''
					? 'no site named'
					: `no site called ${site}`
				: collectedAt === null
					? 'no date read'
					: values.length === 0
						? 'no values'
						: null;
		return { site, siteId, collectedAt, values, problem };
	});
}

/** The parameters a block would write, for the closure that says what recomputes. */
export function batchParameters(visits: BatchVisit[]): string[] {
	return [
		...new Set(visits.filter((v) => v.problem === null).flatMap((v) => v.values.map((x) => x.parameterId))),
	];
}

/** Where a project's column layout is remembered between pastes. */
export function layoutKey(projectId: string): string {
	return `river.visits.layout.${projectId}`;
}
