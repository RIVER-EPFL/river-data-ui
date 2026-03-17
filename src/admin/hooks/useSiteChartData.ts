import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuthFetch } from './useAuthFetch';
import { resolveAggregation } from '../utils/timeRange';
import type { AnnotationData } from '../resources/sites/annotationPlugins';

export interface ReadingsResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    values: Array<number | null>;
    flagged?: Array<boolean | null>;
    flag_reasons?: Array<string | null>;
  }>;
}

export interface AggregatesResponse {
  times: string[];
  parameters: Array<{
    id: string;
    name: string;
    type: string;
    units: string | null;
    avg: Array<number | null>;
    min: Array<number | null>;
    max: Array<number | null>;
    count: number[];
  }>;
}

export interface SiteChartData {
  data: ReadingsResponse | AggregatesResponse | null;
  isAggregate: boolean;
  annotations: AnnotationData[];
  grabData: ReadingsResponse | null;
  loading: boolean;
  refetch: () => void;
}

/**
 * Fetches all chart data for a site in 3 parallel requests:
 * readings/aggregates, annotations, and grab samples.
 * Replaces the N+1 pattern where each ParameterChart fetched independently.
 */
export function useSiteChartData(
  siteId: string | undefined,
  start: number,
  end: number,
): SiteChartData {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<ReadingsResponse | AggregatesResponse | null>(null);
  const [isAggregate, setIsAggregate] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [grabData, setGrabData] = useState<ReadingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!siteId || !start || !end) return;

    const id = ++fetchIdRef.current;
    setLoading(true);

    const startISO = new Date(start).toISOString();
    const endISO = new Date(end).toISOString();
    const spanMs = end - start;
    const resolved = resolveAggregation(spanMs);
    const agg = resolved !== 'raw';

    const dataUrl = agg
      ? `/api/service/sites/${siteId}/aggregates/${resolved}?start=${startISO}&format=json&end=${endISO}`
      : `/api/service/sites/${siteId}/readings?start=${startISO}&page_size=10000&format=json&measurement_type=continuous&include_flagged=true&end=${endISO}`;

    const annotUrl = `/api/service/sites/${siteId}/annotations?start=${startISO}&end=${endISO}`;
    const grabUrl = `/api/service/sites/${siteId}/readings?start=${startISO}&page_size=10000&format=json&measurement_type=spot&end=${endISO}`;

    try {
      const [dataRes, annRes, grabRes] = await Promise.all([
        authFetch(dataUrl),
        authFetch(annotUrl).catch((err) => { console.error('Failed to fetch annotations:', err); return null as Response | null; }),
        authFetch(grabUrl).catch((err) => { console.error('Failed to fetch grab samples:', err); return null as Response | null; }),
      ]);

      if (id !== fetchIdRef.current) return;
      if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status}`);

      const parsedData = await dataRes.json();
      const parsedAnnotations: AnnotationData[] = annRes?.ok ? await annRes.json() : [];
      const parsedGrab: ReadingsResponse | null = grabRes?.ok ? await grabRes.json() : null;

      if (id !== fetchIdRef.current) return;

      setData(parsedData);
      setIsAggregate(agg);
      setAnnotations(parsedAnnotations);
      setGrabData(parsedGrab);
    } catch (err) {
      console.error('Failed to fetch site chart data:', err);
      if (id === fetchIdRef.current) {
        setData(null);
        setAnnotations([]);
        setGrabData(null);
      }
    } finally {
      if (id === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [siteId, start, end, authFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return { data, isAggregate, annotations, grabData, loading, refetch: fetchAll };
}
