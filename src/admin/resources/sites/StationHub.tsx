import React, { useState, useMemo } from 'react';
import {
    useGetOne,
    useGetList,
    Title,
    Loading,
} from 'react-admin';
import {
    Box,
    Typography,
    Grid2 as Grid,
    Alert,
    Button,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useParams } from 'react-router-dom';
import { StationHeader } from './StationHeader';
import { SensorCard } from './SensorCard';
import { DerivedSection } from './DerivedSection';
import { ParameterChart } from './ParameterChart';
import { DataExportDialog } from './DataExportDialog';
import { StatusEventsTimeline } from './StatusEventsTimeline';
import { useLatestReadings, useSensorGroups } from './hooks';
import type {
    ParameterRecord,
    SensorDeploymentRecord,
    SensorRecord,
    AlarmThresholdRecord,
} from './SensorCard';
import type { DerivedParameterRecord } from './DerivedSection';

// ---------------------------------------------------------------------------
// Types (local to StationHub)
// ---------------------------------------------------------------------------

interface SiteRecord {
    id: string;
    name: string;
    project_id: string;
    latitude: number | null;
    longitude: number | null;
    altitude_m: number | null;
    created_at: string;
}

interface ProjectRecord {
    id: string;
    name: string;
}

// ---------------------------------------------------------------------------
// Station Hub (main component)
// ---------------------------------------------------------------------------

const StationHub = () => {
    const { id } = useParams<{ id: string }>();
    const [exportOpen, setExportOpen] = useState(false);

    // Fetch site
    const {
        data: site,
        isPending: siteLoading,
        error: siteError,
    } = useGetOne<SiteRecord>('sites', { id: id! }, { enabled: !!id });

    // Fetch project for the header link
    const {
        data: project,
    } = useGetOne<ProjectRecord>(
        'projects',
        { id: site?.project_id ?? '' },
        { enabled: !!site?.project_id },
    );

    // Fetch parameters for this site
    const {
        data: parameters,
        isPending: paramsLoading,
    } = useGetList<ParameterRecord>('site_parameters', {
        filter: { site_id: id },
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: !!id });

    // Collect parameter IDs for filtered fetching
    const parameterIds = useMemo(
        () => (parameters ?? []).map((p) => p.id),
        [parameters],
    );

    // Fetch sensor deployments filtered by this site's parameter IDs
    const {
        data: deployments,
        isPending: deploymentsLoading,
    } = useGetList<SensorDeploymentRecord>('sensor_deployments', {
        filter: { parameter_id: parameterIds },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'deployed_from', order: 'DESC' },
    }, { enabled: parameterIds.length > 0 });

    // Fetch alarm thresholds filtered by this site's parameter IDs
    const {
        data: thresholds,
    } = useGetList<AlarmThresholdRecord>('alarm_thresholds', {
        filter: { parameter_id: parameterIds },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'parameter_id', order: 'ASC' },
    }, { enabled: parameterIds.length > 0 });

    // Collect distinct sensor IDs from loaded deployments
    const sensorIds = useMemo(() => {
        if (!deployments) return [];
        const ids = new Set<string>();
        deployments.forEach((d) => ids.add(d.sensor_id));
        return Array.from(ids);
    }, [deployments]);

    // Fetch only the sensors referenced by deployments
    const {
        data: sensors,
    } = useGetList<SensorRecord>('sensors', {
        filter: { id: sensorIds },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'serial_number', order: 'ASC' },
    }, { enabled: sensorIds.length > 0 });

    // Fetch derived parameter definitions
    const {
        data: derivedDefs,
    } = useGetList<DerivedParameterRecord>('derived_parameters', {
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: !!id });

    // Fetch latest readings for this site
    const latestByParam = useLatestReadings(id);

    // Build lookup maps
    const sensorById = useMemo(() => {
        const map = new Map<string, SensorRecord>();
        sensors?.forEach((s) => map.set(s.id, s));
        return map;
    }, [sensors]);

    const thresholdsByParam = useMemo(() => {
        const map = new Map<string, AlarmThresholdRecord>();
        thresholds?.forEach((t) => map.set(t.parameter_id, t));
        return map;
    }, [thresholds]);

    const derivedDefById = useMemo(() => {
        const map = new Map<string, DerivedParameterRecord>();
        derivedDefs?.forEach((d) => map.set(d.id, d));
        return map;
    }, [derivedDefs]);

    // Group parameters by sensor (via deployments)
    const sensorGroups = useSensorGroups(parameters, deployments, sensorById);

    // Derived parameters
    const derivedParams = useMemo(
        () => (parameters ?? []).filter((p) => p.is_derived),
        [parameters],
    );

    // Parameter name lookup for status events
    const parameterNames = useMemo(() => {
        const map = new Map<string, string>();
        parameters?.forEach((p) => map.set(p.id, p.name));
        return map;
    }, [parameters]);

    // Status summary counts
    const statusSummary = useMemo(() => {
        if (!parameters) return { active: 0, inactive: 0, total: 0, sensorsActive: 0 };
        const active = parameters.filter((p) => p.is_active).length;
        const sensorsActive = sensorGroups.filter(
            (g) => g.sensorId !== '__unassigned__' && g.sensor?.is_active !== false,
        ).length;
        return { active, inactive: parameters.length - active, total: parameters.length, sensorsActive };
    }, [parameters, sensorGroups]);

    // Loading / Error states
    if (siteLoading || paramsLoading || deploymentsLoading) {
        return <Loading />;
    }

    if (siteError) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error">
                    Failed to load site: {siteError instanceof Error ? siteError.message : 'Unknown error'}
                </Alert>
            </Box>
        );
    }

    if (!site) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="warning">Site not found</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2 }}>
            <Title title={`Station Hub: ${site.name}`} />

            {/* Header */}
            <StationHeader
                site={site}
                project={project}
                statusSummary={statusSummary}
            />

            {/* Sensor Cards */}
            <Typography variant="h6" sx={{ mb: 2 }}>
                Deployed Sensors
            </Typography>

            {sensorGroups.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    No sensor deployments found for this site.
                </Alert>
            )}

            <Grid container spacing={2}>
                {sensorGroups.map((group) => (
                    <Grid key={group.sensorId} size={{ xs: 12, md: 6, xl: 4 }}>
                        <SensorCard
                            group={group}
                            thresholdsByParam={thresholdsByParam}
                            latestByParam={latestByParam}
                            siteName={site.name}
                        />
                    </Grid>
                ))}
            </Grid>

            {/* Charts */}
            {(parameters ?? []).filter((p) => !p.is_derived).length > 0 && (
                <Box sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6">
                            Time Series
                        </Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<DownloadIcon />}
                            onClick={() => setExportOpen(true)}
                        >
                            Export Data
                        </Button>
                    </Box>
                    {(parameters ?? [])
                        .filter((p) => !p.is_derived)
                        .map((param, index) => (
                            <ParameterChart
                                key={param.id}
                                siteId={id!}
                                parameterId={param.id}
                                parameterName={param.name}
                                units={param.display_units}
                                threshold={thresholdsByParam.get(param.id) ? {
                                    warning_min: thresholdsByParam.get(param.id)!.warning_min,
                                    warning_max: thresholdsByParam.get(param.id)!.warning_max,
                                    alarm_min: thresholdsByParam.get(param.id)!.alarm_min,
                                    alarm_max: thresholdsByParam.get(param.id)!.alarm_max,
                                } : undefined}
                                defaultExpanded={index < 3}
                            />
                        ))}
                </Box>
            )}

            {/* Device Status Events */}
            <StatusEventsTimeline
                siteId={id!}
                parameterNames={parameterNames}
            />

            {/* Derived Parameters */}
            <DerivedSection
                derivedParams={derivedParams}
                derivedDefs={derivedDefById}
                allSiteParams={parameters ?? []}
                latestByParam={latestByParam}
                deployments={deployments ?? []}
            />

            {/* Data Export Dialog */}
            <DataExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                siteId={id!}
                siteName={site.name}
                parameters={(parameters ?? []).filter((p) => !p.is_derived).map((p) => ({ id: p.id, name: p.name }))}
            />
        </Box>
    );
};

export default StationHub;
