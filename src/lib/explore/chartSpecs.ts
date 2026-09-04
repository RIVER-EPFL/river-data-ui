import type { Frequency } from '$lib/charts/multiSiteSeries';

export type Resolution = 'raw' | 'hourly' | 'daily';

/** One scatter chart on the Explore page: a site, two axes and a time range. */
export interface ScatterSpec {
	siteId: string;
	xParamId: string;
	yParamId: string;
	start: number;
	end: number;
}

/** One time-series chart on the Explore page: sites, a parameter, cadence and a time range. */
export interface TimeSeriesSpec {
	siteIds: string[];
	paramId: string;
	resolution: Resolution;
	frequency: Frequency;
	start: number;
	end: number;
}

const RESOLUTIONS: Resolution[] = ['raw', 'hourly', 'daily'];
const FREQUENCIES: Frequency[] = ['high', 'low', 'all'];

export function emptyScatterSpec(siteId = ''): ScatterSpec {
	return { siteId, xParamId: '', yParamId: '', start: 0, end: 0 };
}

export function emptyTimeSeriesSpec(): TimeSeriesSpec {
	return { siteIds: [], paramId: '', resolution: 'hourly', frequency: 'high', start: 0, end: 0 };
}

function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
	return allowed.includes(v as T) ? (v as T) : fallback;
}

function parseArray(raw: string | null): Record<string, unknown>[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
	} catch {
		return [];
	}
}

// The URL form uses one-letter keys so a layout of several charts stays a readable query param.

export function encodeScatterSpecs(specs: ScatterSpec[]): string {
	if (specs.length === 0) return '';
	return JSON.stringify(
		specs.map((s) => ({ s: s.siteId, x: s.xParamId, y: s.yParamId, f: s.start, t: s.end })),
	);
}

export function decodeScatterSpecs(raw: string | null): ScatterSpec[] {
	return parseArray(raw)
		.filter((e) => typeof e.s === 'string')
		.map((e) => ({ siteId: str(e.s), xParamId: str(e.x), yParamId: str(e.y), start: num(e.f), end: num(e.t) }));
}

export function encodeTimeSeriesSpecs(specs: TimeSeriesSpec[]): string {
	if (specs.length === 0) return '';
	return JSON.stringify(
		specs.map((s) => ({ s: s.siteIds, p: s.paramId, r: s.resolution, q: s.frequency, f: s.start, t: s.end })),
	);
}

export function decodeTimeSeriesSpecs(raw: string | null): TimeSeriesSpec[] {
	return parseArray(raw)
		.filter((e) => Array.isArray(e.s))
		.map((e) => ({
			siteIds: (e.s as unknown[]).filter((v): v is string => typeof v === 'string'),
			paramId: str(e.p),
			resolution: oneOf(e.r, RESOLUTIONS, 'hourly'),
			frequency: oneOf(e.q, FREQUENCIES, 'high'),
			start: num(e.f),
			end: num(e.t),
		}));
}
