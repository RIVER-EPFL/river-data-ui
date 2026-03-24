import { useState, useMemo, useEffect } from 'react';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import type {
    ParameterRecord,
    SensorDeploymentRecord,
    SensorRecord,
    SensorGroup,
    LatestReading,
} from './SensorCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Readings API response shape
export interface ReadingsApiResponse {
    times: string[];
    parameters: Array<{
        id: string;
        name: string;
        type: string;
        units: string | null;
        values: Array<number | null>;
    }>;
}

// ---------------------------------------------------------------------------
// Hook: Fetch latest readings for a site
// ---------------------------------------------------------------------------

export function useLatestReadings(siteId: string | undefined): Map<string, LatestReading> {
    const [latestByParam, setLatestByParam] = useState<Map<string, LatestReading>>(new Map());
    const authFetch = useAuthFetch();

    useEffect(() => {
        if (!siteId) return;

        const now = new Date();
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const url = `/api/service/sites/${siteId}/readings?start=${start.toISOString()}&page_size=1000&format=json`;

        authFetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<ReadingsApiResponse>;
            })
            .then((data) => {
                const map = new Map<string, LatestReading>();
                if (data.times?.length && data.parameters?.length) {
                    for (const param of data.parameters) {
                        // Walk backwards through values to find the latest non-null reading
                        for (let i = data.times.length - 1; i >= 0; i--) {
                            const val = param.values[i];
                            if (val != null) {
                                map.set(param.id, { value: val, time: data.times[i] });
                                break;
                            }
                        }
                    }
                }
                setLatestByParam(map);
            })
            .catch((err) => {
                console.error('Failed to fetch latest readings:', err);
            });
    }, [siteId]);

    return latestByParam;
}

// ---------------------------------------------------------------------------
// Hook: Group parameters by sensor (via deployments)
// ---------------------------------------------------------------------------

export function useSensorGroups(
    parameters: ParameterRecord[] | undefined,
    deployments: SensorDeploymentRecord[] | undefined,
    sensorById: Map<string, SensorRecord>,
): SensorGroup[] {
    return useMemo(() => {
        if (!parameters || !deployments) return [];

        // Build lookup: global parameter_id -> site_parameter
        const siteParamByGlobalId = new Map<string, ParameterRecord>();
        parameters.forEach((p) => {
            if (!p.is_derived) siteParamByGlobalId.set(p.parameter_id, p);
        });

        // Collect all deployments by sensor, and track active deployments
        const allDeploysBySensor = new Map<string, SensorDeploymentRecord[]>();
        const activeSensorIds = new Set<string>();

        deployments.forEach((d) => {
            const list = allDeploysBySensor.get(d.sensor_id) ?? [];
            list.push(d);
            allDeploysBySensor.set(d.sensor_id, list);
            if (!d.deployed_until) activeSensorIds.add(d.sensor_id);
        });

        // Group site_parameters by sensor via sensor.parameter_id matching
        const groups = new Map<string, { deployments: SensorDeploymentRecord[]; paramIds: Set<string> }>();
        const matchedParamIds = new Set<string>();

        activeSensorIds.forEach((sensorId) => {
            const sensor = sensorById.get(sensorId);
            if (!sensor?.parameter_id) return;

            const siteParam = siteParamByGlobalId.get(sensor.parameter_id);
            if (!siteParam) return;

            matchedParamIds.add(siteParam.id);
            const existing = groups.get(sensorId);
            if (existing) {
                existing.paramIds.add(siteParam.id);
            } else {
                groups.set(sensorId, {
                    deployments: allDeploysBySensor.get(sensorId) ?? [],
                    paramIds: new Set([siteParam.id]),
                });
            }
        });

        const result: SensorGroup[] = [];

        groups.forEach((value, sensorId) => {
            result.push({
                sensorId,
                sensor: sensorById.get(sensorId),
                deployments: value.deployments,
                parameters: parameters.filter((p) => value.paramIds.has(p.id)),
            });
        });

        // Add ungrouped non-derived parameters
        const ungroupedParams = parameters.filter((p) => !p.is_derived && !matchedParamIds.has(p.id));
        if (ungroupedParams.length > 0) {
            result.push({
                sensorId: '__unassigned__',
                sensor: undefined,
                deployments: [],
                parameters: ungroupedParams,
            });
        }

        // Sort by sensor name/serial
        result.sort((a, b) => {
            const sa = a.sensor?.serial_number ?? a.sensor?.name ?? 'zzz';
            const sb = b.sensor?.serial_number ?? b.sensor?.name ?? 'zzz';
            return sa.localeCompare(sb);
        });

        return result;
    }, [parameters, deployments, sensorById]);
}
