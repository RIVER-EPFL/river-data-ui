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

export interface RiverDataProvider extends DataProvider {
  triggerSync: () => Promise<{ data: unknown }>;
  getSyncState: () => Promise<{ data: unknown }>;
  recalibrateCalibration: (id: string) => Promise<{ data: unknown }>;
  recomputeDerived: (id: string) => Promise<{ data: unknown }>;
  uploadCsv: (file: File, params: Record<string, string>) => Promise<{ data: unknown }>;
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
          `The ${countHeader} header is missing in the HTTP Response. The simple REST data provider expects responses for lists of resources to contain this header with the total number of results to build the pagination. If you are using CORS, did you declare ${countHeader} in the Access-Control-Expose-Headers header?`
        );
      }
      return {
        data: json,
        total:
          countHeader === 'Content-Range'
            ? parseInt(headers.get('content-range')!.split('/').pop()!, 10)
            : parseInt(headers.get(countHeader.toLowerCase())!),
      };
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
      return {
        data: json,
        total:
          countHeader === 'Content-Range'
            ? parseInt(headers.get('content-range')!.split('/').pop()!, 10)
            : parseInt(headers.get(countHeader.toLowerCase())!),
      };
    });
  },

  update: (resource, params) => {
    return httpClient(`${apiUrl}/${resource}/${params.id}`, {
      method: 'PUT',
      body: JSON.stringify(params.data),
    }).then(({ json }) => ({ data: json }));
  },

  updateMany: (resource, params) => {
    return httpClient(`${apiUrl}/${resource}/batch`, {
      method: 'PUT',
      body: JSON.stringify({ ids: params.ids, data: params.data }),
    }).then(({ json }) => ({ data: json }));
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
    return httpClient(`${apiUrl}/${resource}/batch`, {
      method: 'DELETE',
      body: JSON.stringify(params.ids),
    }).then(({ json }) => ({ data: json }));
  },

  // Custom methods for river-data
  triggerSync: () => {
    return httpClient(`${apiUrl}/sync/trigger`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  getSyncState: () => {
    return httpClient(`${apiUrl}/sync/state`).then(({ json }) => ({
      data: json,
    }));
  },

  recalibrateCalibration: (id: string) => {
    return httpClient(`${apiUrl}/sensor_calibrations/${id}/recalculate`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  recomputeDerived: (id: string) => {
    return httpClient(`${apiUrl}/derived_parameters/${id}/recompute`, {
      method: 'POST',
    }).then(({ json }) => ({ data: json }));
  },

  uploadCsv: (file: File, params: Record<string, string>) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.entries(params).forEach(([key, value]) => {
      formData.append(key, value);
    });

    return httpClient(`${apiUrl}/data_imports/upload`, {
      method: 'POST',
      body: formData,
    }).then(({ json }) => ({ data: json }));
  },
});

export default dataProvider;
