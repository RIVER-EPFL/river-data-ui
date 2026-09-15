/** Where a row came from, in one vocabulary for every list that holds imported rows. */
export type Origin = 'any' | 'manual' | 'sync' | `source:${string}`;

/** An origin, as one concept whatever column of the API names it. */
export type OriginKind = 'entry' | 'tool_run' | 'chain' | 'csv' | 'api' | 'derived' | 'sync';

/**
 * One phrase per origin, said as where the value came from rather than as a judgement on it. Every
 * surface that names an origin reads from here, so a value does not arrive one way on the chart
 * tooltip and another in its record.
 */
const ORIGIN_PHRASE: Record<OriginKind, string> = {
	entry: 'entered in the grid',
	tool_run: 'computed by a tool',
	chain: 'computed by the chain',
	csv: 'CSV import',
	api: 'API batch',
	derived: 'computed by a derived parameter',
	sync: 'sync service',
};

/** What a surface can add to a phrase where it knows it. */
export type OriginDetail = { source?: string; actor?: string; calculation?: string };

/** The phrase for an origin, naming the source, the person or the calculation where one is known. */
export function originPhrase(kind: OriginKind, detail: OriginDetail = {}): string {
	if (kind === 'sync' && detail.source) return `${detail.source} sync`;
	if (detail.calculation && (kind === 'tool_run' || kind === 'chain' || kind === 'derived'))
		return `computed by ${detail.calculation}`;
	if (kind === 'entry' && detail.actor) return `entered in the grid by ${detail.actor}`;
	return ORIGIN_PHRASE[kind];
}

/** The origin a stream's source system names. Mirrors `classify_source` on the API. */
export function originKindOfSource(sourceSystem: string): OriginKind {
	if (sourceSystem === 'grab_sample') return 'entry';
	if (sourceSystem === 'csv' || sourceSystem === 'csv_import') return 'csv';
	if (sourceSystem === 'api') return 'api';
	if (sourceSystem === 'derived') return 'derived';
	return 'sync';
}

/** The origin a reading's own recorded kind names, or undefined for a kind this build predates. */
export function originKindOfProvenance(kind: string): OriginKind | undefined {
	const kinds: Record<string, OriginKind> = {
		tool_run: 'tool_run',
		chain: 'chain',
		csv_import: 'csv',
		manual: 'entry',
		batch: 'api',
		sync: 'sync',
		derived: 'derived',
	};
	return kinds[kind];
}

/** The origin a record's classification names, or undefined for one this build predates. */
export function originKindOfClassification(classification: string): OriginKind | undefined {
	const kinds: Record<string, OriginKind> = {
		manual: 'entry',
		csv: 'csv',
		api: 'api',
		derived: 'derived',
		sync: 'sync',
	};
	return kinds[classification];
}

/** How a row reads from the source system its stream names. */
export function originLabel(sourceSystem: string, detail: OriginDetail = {}): string {
	return originPhrase(originKindOfSource(sourceSystem), { source: sourceSystem, ...detail });
}

/**
 * How a reading reads from its own recorded origin, which is narrower than its stream's: an entry
 * and a tool save arrive on the same channel and are not the same act. The server may name a kind
 * this build does not know, so an unknown one passes through.
 */
export function provenanceKindLabel(
	kind: string | undefined,
	detail: OriginDetail = {},
): string | undefined {
	if (!kind) return undefined;
	const origin = originKindOfProvenance(kind);
	return origin ? originPhrase(origin, detail) : kind;
}

/** How a record reads from the classification the provenance route resolved for it. */
export function classificationLabel(
	classification: string,
	sourceSystem?: string,
	detail: OriginDetail = {},
): string {
	const origin = originKindOfClassification(classification);
	if (!origin) return classification;
	return originPhrase(origin, { source: sourceSystem, ...detail });
}

/**
 * How a row reads on a surface that shows one phrase for it: its own recorded kind where it has
 * one, else the source system its stream names.
 */
export function rowProvenanceLabel(
	kind: string | undefined,
	sourceSystem: string | undefined
): string | undefined {
	return provenanceKindLabel(kind) ?? (sourceSystem ? originLabel(sourceSystem) : undefined);
}

/** The source system named by an origin, or null for the origins that name none. */
export function originSource(origin: Origin): string | null {
	return origin.startsWith('source:') ? origin.slice('source:'.length) : null;
}

/**
 * The filter fragment for an origin, over the column that records it. `column` is
 * `source_system` where the entity names its source and `discovered_at` where it only carries the
 * stamp a sync leaves, which is why "from a sync" is a null test rather than a value.
 */
export function originFilter(
	origin: Origin,
	column: 'source_system' | 'discovered_at',
): Record<string, unknown> {
	const source = originSource(origin);
	if (source) return { [column]: source };
	if (origin === 'sync') return { [`${column}_neq`]: null };
	if (origin === 'manual') return { [column]: null };
	return {};
}
