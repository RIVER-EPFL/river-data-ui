import queryString from 'query-string';
import { fetchUtils, DataProvider } from 'ra-core';

const { stringify } = queryString;

const convertBooleanStrings = (filter: Record<string, unknown>) => {
  const converted = { ...filter };
  Object.keys(converted).forEach((key) => {
    if (converted[key] === 'true') converted[key] = true;
    else if (converted[key] === 'false') converted[key] = false;
    else if (converted[key] === '__null__') converted[key] = null;
  });
  return converted;
};

export interface PreviewDerivedRequest {
  formula: string;
  site_id: string;
  start: string;
  end: string;
}

export interface PreviewDerivedResponse {
  site: { id: string; name: string };
  times: string[];
  source_parameters: Array<{ name: string; units: string; values: (number | null)[] }>;
  derived: { name: string; formula: string; values: (number | null)[]; errors: (string | null)[] };
}

export interface SyncService {
  id: string;
  service_type: string;
  instance_id: string;
  status: 'starting' | 'running' | 'paused' | 'error';
  current_operation: string | null;
  last_heartbeat: string | null;
  last_sync_completed_at: string | null;
  last_error: string | null;
  health: string;
  created_at: string;
  updated_at: string;
}

export interface SyncCommand {
  id: string;
  service_id: string;
  command: string;
  payload: object | null;
  status: 'pending' | 'acknowledged' | 'completed' | 'failed' | 'expired';
  result: object | null;
  created_at: string;
  expires_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
}

export interface ServiceCredential {
  id: string;
  client_id: string;
  service_type: string;
  service_id: string | null;
  revoked: boolean;
  created_at: string;
}

export interface SyncEvent {
  id: string;
  service_id: string;
  command_id: string | null;
  event_type: 'scheduled' | 'triggered' | 'full_sync';
  status: 'running' | 'completed' | 'partial' | 'failed';
  readings_synced: number;
  status_events_synced: number;
  errors: string[] | null;
  log: string[] | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface StreamState {
  id: string;
  source_system: string;
  source_key: string;
  source_name: string | null;
  source_path: string | null;
  metadata: Record<string, unknown>;
  site_parameter_id: string | null;
  is_active: boolean;
  last_data_time: string | null;
}

export interface StreamStats {
  stream_id: string;
  reading_count: number;
  min_time: string | null;
  max_time: string | null;
  latest_value: number | null;
}

export interface DiscoveryMatch {
  id: string;
  name: string;
}

export interface DiscoverySuggestion {
  match: DiscoveryMatch | null;
  confidence: 'exact' | 'fuzzy' | 'none';
  suggested_name?: string;
  suggested_units?: string;
}

export interface DiscoveryItem {
  stream: {
    id: string;
    source_name: string | null;
    source_path: string | null;
    metadata: Record<string, unknown>;
  };
  suggestions: {
    project: DiscoverySuggestion;
    site: DiscoverySuggestion;
    parameter: DiscoverySuggestion;
    site_parameter: DiscoverySuggestion;
  };
  action: 'pair_existing' | 'create_and_pair' | 'needs_input';
}

export interface ApplyAction {
  stream_id: string;
  create_project?: { name: string } | null;
  create_site?: { name: string } | null;
  create_parameter?: { name: string; display_name: string; default_units: string; category: string } | null;
  create_site_parameter?: { display_units?: string; sample_interval_sec?: number; channel_id?: number } | null;
  pair_to: string;
  use_project_id?: string | null;
  use_site_id?: string | null;
  use_parameter_id?: string | null;
}

export interface ApplyDiscoveryResponse {
  projects_created: number;
  sites_created: number;
  parameters_created: number;
  site_parameters_created: number;
  streams_paired: number;
  total_backfilled: number;
  errors: string[];
}

export interface SearchResponse {
  query: string;
  results: {
    sites: Array<{ id: string; name: string }>;
    sensors: Array<{ id: string; serial_number: string | null; name: string | null }>;
    parameters: Array<{ id: string; name: string; display_name: string }>;
    projects: Array<{ id: string; name: string }>;
  };
  total: number;
}

export interface ActiveAlarm {
  site_id: string;
  site_name: string;
  parameter_id: string;
  parameter_name: string;
  current_value: number;
  threshold: {
    warning_min: number | null;
    warning_max: number | null;
    alarm_min: number | null;
    alarm_max: number | null;
  };
  severity: number;
  since: string;
}

export interface ActiveAlarmsResponse {
  alarms: ActiveAlarm[];
  total: number;
}

export interface AlarmSummaryResponse {
  total: number;
  by_severity: { warning: number; alarm: number };
  by_site: Array<{
    site_id: string;
    site_name: string;
    warning_count: number;
    alarm_count: number;
  }>;
}

export interface KeycloakRole {
  id: string;
  name: string;
}

export interface RiverDataProvider extends DataProvider {
  search: (query: string) => Promise<{ data: SearchResponse }>;
  getActiveAlarms: () => Promise<{ data: ActiveAlarmsResponse }>;
  getAlarmSummary: () => Promise<{ data: AlarmSummaryResponse }>;
  getStreamStats: (streamId: string) => Promise<{ data: StreamStats }>;
  pairStream: (streamId: string, siteParameterId: string) => Promise<{ data: unknown }>;
  unpairStream: (streamId: string) => Promise<{ data: unknown }>;
  getDiscovery: () => Promise<{ data: DiscoveryItem[] }>;
  applyDiscovery: (actions: ApplyAction[]) => Promise<{ data: ApplyDiscoveryResponse }>;
  recalibrateCalibration: (id: string) => Promise<{ data: unknown }>;
  recomputeDerived: (id: string) => Promise<{ data: unknown }>;
  invalidatePublicConfig: (slug: string) => Promise<{ data: unknown }>;
  previewDerived: (params: PreviewDerivedRequest) => Promise<{ data: PreviewDerivedResponse }>;
  getSyncServices: () => Promise<{ data: SyncService[] }>;
  issueSyncCommand: (serviceId: string, command: string, payload?: object) => Promise<{ data: SyncCommand }>;
  getSyncCommands: () => Promise<{ data: SyncCommand[] }>;
  getSyncEvents: (params?: { page?: number; perPage?: number }) => Promise<{ data: SyncEvent[]; total: number }>;
  createServiceCredential: (serviceType: string) => Promise<{ data: { client_id: string; client_secret: string } }>;
  listServiceCredentials: () => Promise<{ data: ServiceCredential[] }>;
  revokeSyncService: (credentialId: string) => Promise<{ data: unknown }>;
  listRoles: () => Promise<{ data: KeycloakRole[] }>;
  assignUserRoles: (userId: string, roles: string[]) => Promise<{ data: unknown }>;
  groupedDiscovery: (sourceSystem: string) => Promise<{ data: GroupedDiscoveryResponse }>;
  bulkPair: (req: BulkPairRequest) => Promise<{ data: BulkPairResponse }>;
}

export interface GroupedProject {
  name: string;
  stream_count: number;
  existing_id: string | null;
}

export interface GroupedSite {
  name: string;
  glacier: string | null;
  stream_count: number;
  existing_id: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
}

export interface GroupedParameter {
  name: string;
  display_name: string;
  units: string;
  stream_count: number;
  existing_id: string | null;
}

export interface GroupedDiscoveryResponse {
  source_system: string;
  total_streams: number;
  projects: GroupedProject[];
  sites: GroupedSite[];
  parameters: GroupedParameter[];
}

export interface BulkPairRequest {
  source_system: string;
  project_name: string;
  sites: { name: string; existing_id: string | null; latitude: number | null; longitude: number | null; altitude_m: number | null }[];
  parameters: { name: string; display_name: string; units: string; existing_id: string | null }[];
}

export interface BulkPairResponse {
  project_created: boolean;
  sites_created: number;
  parameters_created: number;
  site_parameters_created: number;
  streams_paired: number;
}

const dataProvider = (
  apiUrl: string,
  httpClient = fetchUtils.fetchJson,
  countHeader: string = 'Content-Range'
): RiverDataProvider => ({
  getList: (resource, params) => {
    const { page = 1, perPage = 25 } = params.pagination ?? {};
    const { field = 'id', order = 'ASC' } = params.sort ?? {};

    const rangeStart = (page - 1) * perPage;
    const rangeEnd = page * perPage - 1;

    const processedFilter = convertBooleanStrings(params.filter ?? {});

    // Extract client-side admin filter for users (Keycloak doesn't support role filtering)
    let filterByAdmin: boolean | undefined;
    if (resource === 'users' && 'admin' in processedFilter) {
      if (processedFilter.admin === true) filterByAdmin = true;
      delete processedFilter.admin;
    }

    // When filtering by admin, fetch all users so we can filter + paginate client-side
    const fetchAll = filterByAdmin !== undefined;
    const effectiveStart = fetchAll ? 0 : rangeStart;
    const effectiveEnd = fetchAll ? 999 : rangeEnd;

    const query = {
      sort: JSON.stringify([field, order]),
      range: JSON.stringify([effectiveStart, effectiveEnd]),
      filter: JSON.stringify(processedFilter),
    };
    const url = `${apiUrl}/${resource}?${stringify(query)}`;
    const options =
      countHeader === 'Content-Range'
        ? {
            headers: new Headers({
              Range: `${resource}=${effectiveStart}-${effectiveEnd}`,
            }),
          }
        : {};

    return httpClient(url, options).then(({ headers, json }) => {
      if (!headers.has(countHeader)) {
        throw new Error(
          `The ${countHeader} header is missing in the HTTP Response. The simple REST data provider expects responses for lists of resources to contain this header with the total number of results to build the pagination. If you are using CORS, did you declare ${countHeader} in the Access-Control-Expose-Headers header?`
        );
      }

      // Client-side role filtering for users
      if (filterByAdmin !== undefined) {
        const filtered = (json as Array<{ roles?: string[] }>).filter((u) =>
          Array.isArray(u.roles) && u.roles.includes('admin'),
        );
        const total = filtered.length;
        const paged = filtered.slice(rangeStart, rangeEnd + 1);
        return { data: paged, total };
      }

      const total =
        countHeader === 'Content-Range'
          ? parseInt(headers.get('content-range')?.split('/').pop() ?? '0', 10)
          : parseInt(headers.get(countHeader.toLowerCase()) ?? '0');
      return { data: json, total: isNaN(total) ? 0 : total };
    });
  },

  getOne: (resource, params) => {
    return httpClient(`${apiUrl}/${resource}/${params.id}`).then(({ json }) => ({
      data: json,
    }));
  },

  getMany: (resource, params) => {
    const query = {
      filter: JSON.stringify({ id: params.ids }),
    };
    const url = `${apiUrl}/${resource}?${stringify(query)}`;
    return httpClient(url).then(({ json }) => ({ data: json }));
  },

  getManyReference: (resource, params) => {
    const { page = 1, perPage = 25 } = params.pagination ?? {};
    const { field = 'id', order = 'ASC' } = params.sort ?? {};

    const rangeStart = (page - 1) * perPage;
    const rangeEnd = page * perPage - 1;

    const processedFilter = convertBooleanStrings({
      ...params.filter,
      [params.target]: params.id,
    });

    const query = {
      sort: JSON.stringify([field, order]),
      range: JSON.stringify([rangeStart, rangeEnd]),
      filter: JSON.stringify(processedFilter),
    };
    const url = `${apiUrl}/${resource}?${stringify(query)}`;
    const options =
      countHeader === 'Content-Range'
        ? {
            headers: new Headers({
              Range: `${resource}=${rangeStart}-${rangeEnd}`,
            }),
          }
        : {};

    return httpClient(url, options).then(({ headers, json }) => {
      if (!headers.has(countHeader)) {
        throw new Error(
          `The ${countHeader} header is missing in the HTTP Response.`
        );
      }
      const total =
        countHeader === 'Content-Range'
          ? parseInt(headers.get('content-range')?.split('/').pop() ?? '0', 10)
          : parseInt(headers.get(countHeader.toLowerCase()) ?? '0');
      return { data: json, total: isNaN(total) ? 0 : total };
    });
  },

  update: (resource, params) => {
    return httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: 'PUT',
      body: JSON.stringify(params.data),
    }).then(({ json }) => ({ data: json }));
  },

  updateMany: (resource, params) => {
    return Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, {
          method: 'PUT',
          body: JSON.stringify(params.data),
        })
      )
    ).then((responses) => ({ data: responses.map(({ json }) => json.id) }));
  },

  create: (resource, params) => {
    return httpClient(`${apiUrl}/${resource}`, {
      method: 'POST',
      body: JSON.stringify(params.data),
    }).then(({ json }) => ({ data: json }));
  },

  delete: (resource, params) =>
    httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: 'DELETE',
      headers: new Headers({ 'Content-Type': 'text/plain' }),
    }).then(({ json }) => ({ data: json })),

  deleteMany: (resource, params) => {
    if (params.ids.length === 0) {
      return Promise.resolve({ data: [] });
    }
    return Promise.all(
      params.ids.map((id) =>
        httpClient(`${apiUrl}/${resource}/${id}`, {
          method: 'DELETE',
          headers: new Headers({ 'Content-Type': 'text/plain' }),
        })
      )
    ).then((responses) => ({ data: responses.map(({ json }) => json.id) }));
  },

  // Custom methods for river-data
  search: (query: string) =>
    httpClient(`${apiUrl}/search?q=${encodeURIComponent(query)}`).then(
      ({ json }) => ({ data: json as SearchResponse }),
    ),

  getActiveAlarms: () =>
    httpClient(`${apiUrl}/alarms/active`).then(
      ({ json }) => ({ data: json as ActiveAlarmsResponse }),
    ),

  getAlarmSummary: () =>
    httpClient(`${apiUrl}/alarms/summary`).then(
      ({ json }) => ({ data: json as AlarmSummaryResponse }),
    ),

  getStreamStats: (streamId: string) =>
    httpClient(`${apiUrl}/streams/${streamId}/stats`).then(({ json }) => ({ data: json })),

  pairStream: (streamId: string, siteParameterId: string) =>
    httpClient(`${apiUrl}/streams/${streamId}/pair`, {
      method: 'POST',
      body: JSON.stringify({ site_parameter_id: siteParameterId }),
    }).then(({ json }) => ({ data: json })),

  unpairStream: (streamId: string) =>
    httpClient(`${apiUrl}/streams/${streamId}/unpair`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json })),

  getDiscovery: () =>
    httpClient(`${apiUrl}/sync/discovery`).then(({ json }) => ({ data: json })),

  applyDiscovery: (actions: ApplyAction[]) =>
    httpClient(`${apiUrl}/sync/apply-discovery`, {
      method: 'POST',
      body: JSON.stringify({ actions }),
    }).then(({ json }) => ({ data: json })),

  recalibrateCalibration: (id: string) => {
    return httpClient(`${apiUrl}/actions/sensor_calibrations/${id}/recalculate`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  recomputeDerived: (id: string) => {
    return httpClient(`${apiUrl}/actions/derived_parameters/${id}/recompute`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  invalidatePublicConfig: (slug: string) => {
    return httpClient(`${apiUrl}/actions/invalidate_public_config/${slug}`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  previewDerived: (params: PreviewDerivedRequest) => {
    return httpClient(`${apiUrl}/actions/preview_derived`, {
      method: 'POST',
      body: JSON.stringify(params),
    }).then(({ json }) => ({ data: json as PreviewDerivedResponse }));
  },

  getSyncServices: () =>
    httpClient(`${apiUrl}/sync/services`).then(({ json }) => ({ data: json })),

  issueSyncCommand: (serviceId: string, command: string, payload?: object) =>
    httpClient(`${apiUrl}/sync/services/${serviceId}/commands`, {
      method: 'POST',
      body: JSON.stringify({ command, payload }),
    }).then(({ json }) => ({ data: json })),

  getSyncCommands: () =>
    httpClient(`${apiUrl}/sync/commands`).then(({ json }) => ({ data: json })),

  getSyncEvents: (params?: { page?: number; perPage?: number }) => {
    const page = params?.page ?? 1;
    const perPage = params?.perPage ?? 25;
    return httpClient(`${apiUrl}/sync/events?page=${page}&per_page=${perPage}`).then(({ headers, json }) => {
      const range = headers.get('Content-Range') || '';
      const match = range.match(/\/(\d+)/);
      const total = match ? parseInt(match[1], 10) : json.length;
      return { data: json, total };
    });
  },

  createServiceCredential: (serviceType: string) =>
    httpClient(`${apiUrl}/sync/credentials`, {
      method: 'POST',
      body: JSON.stringify({ service_type: serviceType }),
    }).then(({ json }) => ({ data: json })),

  listServiceCredentials: () =>
    httpClient(`${apiUrl}/sync/credentials`).then(({ json }) => ({ data: json })),

  revokeSyncService: (credentialId: string) =>
    httpClient(`${apiUrl}/sync/credentials/${credentialId}/revoke`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json })),

  listRoles: () =>
    httpClient(`${apiUrl}/roles`).then(({ json }) => ({ data: json as KeycloakRole[] })),

  assignUserRoles: (userId: string, roles: string[]) =>
    httpClient(`${apiUrl}/users/${userId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ roles }),
    }).then(({ json }) => ({ data: json })),

  groupedDiscovery: (sourceSystem: string) =>
    httpClient(`${apiUrl}/sync/grouped-discovery`, {
      method: 'POST',
      body: JSON.stringify({ source_system: sourceSystem }),
    }).then(({ json }) => ({ data: json as GroupedDiscoveryResponse })),

  bulkPair: (req: BulkPairRequest) =>
    httpClient(`${apiUrl}/sync/bulk-pair`, {
      method: 'POST',
      body: JSON.stringify(req),
    }).then(({ json }) => ({ data: json as BulkPairResponse })),
});

export default dataProvider;
