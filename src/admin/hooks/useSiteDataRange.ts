import { useState, useEffect, useRef } from 'react';
import { useKeycloak } from '../KeycloakContext';

export interface DataRange {
  /** Earliest data timestamp in ms (0 while loading or no data) */
  min: number;
  /** Latest data timestamp in ms (0 while loading or no data) */
  max: number;
  loading: boolean;
}

const EMPTY: DataRange = { min: 0, max: 0, loading: false };

/**
 * Fetches data_start / data_end for one or more sites and returns the union range.
 * For multiple sites, min = earliest start, max = latest end.
 */
export function useSiteDataRange(siteIds: string[]): DataRange {
  const keycloak = useKeycloak();
  const [range, setRange] = useState<DataRange>(EMPTY);
  const prevKey = useRef('');

  useEffect(() => {
    const key = siteIds.filter(Boolean).sort().join(',');
    if (!key) {
      setRange(EMPTY);
      prevKey.current = '';
      return;
    }

    // Skip if same set of sites
    if (key === prevKey.current) return;
    prevKey.current = key;

    let cancelled = false;
    setRange((r) => ({ ...r, loading: true }));

    const headers: HeadersInit = keycloak?.token
      ? { Authorization: 'Bearer ' + keycloak.token }
      : {};

    Promise.all(
      siteIds.filter(Boolean).map((id) =>
        fetch(`/api/service/sites/${id}/detail`, { headers })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;

      let min = Infinity;
      let max = -Infinity;

      for (const data of results) {
        if (!data?.data_start || !data?.data_end) continue;
        const s = new Date(data.data_start).getTime();
        const e = new Date(data.data_end).getTime();
        if (s < min) min = s;
        if (e > max) max = e;
      }

      if (min === Infinity || max === -Infinity) {
        setRange({ min: 0, max: 0, loading: false });
      } else {
        setRange({ min, max, loading: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [siteIds.join(','), keycloak?.token]);

  return range;
}
