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

        // Build: parameter_id -> active deployment
        const activeDeployByParam = new Map<string, SensorDeploymentRecord>();
        const allDeploysBySensor = new Map<string, SensorDeploymentRecord[]>();

        const siteParamIds = new Set(parameters.map((p) => p.id));

        deployments.forEach((d) => {
            if (!siteParamIds.has(d.parameter_id)) return;
            if (!d.deployed_until) {
                activeDeployByParam.set(d.parameter_id, d);
            }
            const list = allDeploysBySensor.get(d.sensor_id) ?? [];
            list.push(d);
            allDeploysBySensor.set(d.sensor_id, list);
        });

        // Group parameters by sensor_id
        const groups = new Map<string, { deployments: SensorDeploymentRecord[]; paramIds: Set<string> }>();
        const ungroupedParams: ParameterRecord[] = [];

        parameters.forEach((param) => {
            if (param.is_derived) return; // Derived params handled separately
            const dep = activeDeployByParam.get(param.id);
            if (dep) {
                const existing = groups.get(dep.sensor_id);
                if (existing) {
                    existing.paramIds.add(param.id);
                } else {
                    groups.set(dep.sensor_id, {
                        deployments: allDeploysBySensor.get(dep.sensor_id) ?? [dep],
                        paramIds: new Set([param.id]),
                    });
                }
            } else {
                ungroupedParams.push(param);
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

        // Add ungrouped parameters as a virtual "no sensor" group if any exist
        if (ungroupedParams.length > 0) {
            result.push({
                sensorId: '__unassigned__',
                sensor: undefined,
                deployments: [],
                parameters: ungroupedParams,
            });
        }

        // Sort by sensor serial
        result.sort((a, b) => {
            const sa = a.sensor?.serial_number ?? 'zzz';
            const sb = b.sensor?.serial_number ?? 'zzz';
            return sa.localeCompare(sb);
        });

        return result;
    }, [parameters, deployments, sensorById]);
}
