import type uPlot from 'uplot';
import { GET } from '$api/client';
import type { ReadingsResponse, AggregatesResponse } from '$lib/api/types';

export type SeriesResolution = 'raw' | 'hourly' | 'daily';

// Which readings drive a plot, by measurement_type: high = continuous field-sensor data,
// low = grab/spot samples, all = both. Aggregates are continuous-only by design, so low-frequency
// series are always fetched via the raw readings path.
export type Frequency = 'high' | 'low' | 'all';

export interface SitePointSeries {
	times: number[]; // epoch ms
	values: (number | null)[];
}

/**
 * Fetch one parameter's series at one site: raw readings, or aggregate averages
 * for hourly/daily. The response series is matched by site_parameter id when
 * known, falling back to the global parameter id.
 */
export async function fetchSiteSeries(opts: {
	siteId: string;
	parameterId: string;
	siteParameterId?: string;
	start: string;
	end: string;
	resolution: SeriesResolution;
	/** Only meaningful on the raw path — aggregates are continuous-only by design. */
	measurementType?: 'continuous' | 'spot';
}): Promise<SitePointSeries> {
	const { siteId, parameterId, siteParameterId, start, end, resolution, measurementType } = opts;
	const query: Record<string, string> = { start, end, parameter_ids: parameterId };
	if (resolution === 'raw' && measurementType) query.measurement_type = measurementType;
	let times: number[] = [];
	let values: (number | null)[] = [];
	if (resolution === 'raw') {
		const result = await GET<ReadingsResponse>(`/api/sites/${siteId}/readings`, query);
		const series = result.parameters?.find(
			(p) => p.id === siteParameterId || p.parameter_id === parameterId,
		);
		if (series && result.times?.length) {
			times = result.times.map((t) => new Date(t).getTime());
			values = series.values;
		}
	} else {
		const result = await GET<AggregatesResponse>(
			`/api/sites/${siteId}/aggregates/${resolution}`,
			query,
		);
		const series = result.parameters?.find(
			(p) => p.id === siteParameterId || p.parameter_id === parameterId,
		);
		if (series && result.times?.length) {
			times = result.times.map((t) => new Date(t).getTime());
			values = series.avg;
		}
	}
	return { times, values };
}

/** Union all timestamps across series and align each onto the shared x-axis (seconds). */
export function mergeSeries(seriesList: SitePointSeries[]): uPlot.AlignedData {
	if (seriesList.length === 0) return [[]];
	const allTimes = new Set<number>();
	for (const s of seriesList) for (const t of s.times) allTimes.add(t);
	const sorted = Array.from(allTimes).sort((a, b) => a - b);
	const xs = sorted.map((t) => t / 1000);
	const ys: (number | null)[][] = seriesList.map((s) => {
		const lookup = new Map<number, number | null>();
		for (let i = 0; i < s.times.length; i++) lookup.set(s.times[i], s.values[i]);
		return sorted.map((t) => lookup.get(t) ?? null);
	});
	return [xs, ...ys] as uPlot.AlignedData;
}

export interface SiteExtent {
	min: number | null;
	max: number | null;
}

const siteExtents = new Map<string, SiteExtent>();

/** Data extent (first/last reading time, ms) for a site, cached per session. */
export async function fetchSiteExtent(siteId: string): Promise<SiteExtent> {
	const cached = siteExtents.get(siteId);
	if (cached) return cached;
	let extent: SiteExtent = { min: null, max: null };
	try {
		const detail = await GET<{ data_start: string | null; data_end: string | null }>(
			`/api/sites/${siteId}/detail`,
		);
		extent = {
			min: detail.data_start ? new Date(detail.data_start).getTime() : null,
			max: detail.data_end ? new Date(detail.data_end).getTime() : null,
		};
	} catch {
		/* non-critical: callers fall back to default bounds */
	}
	siteExtents.set(siteId, extent);
	return extent;
}

export function autoResolution(startMs: number, endMs: number): SeriesResolution {
	const days = (endMs - startMs) / 86400000;
	if (days <= 14) return 'raw';
	if (days <= 120) return 'hourly';
	return 'daily';
}
