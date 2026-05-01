import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    Title,
    useGetList,
    useGetOne,
    useCreate,
    useUpdate,
    useNotify,
    Loading,
} from 'react-admin';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    CircularProgress,
    Divider,
    List as MuiList,
    ListItemButton,
    ListItemText,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { tokens } from '../../theme';
import { snippets } from '../../themeSnippets';
import { SensorStatusPin } from './SensorStatusPin';

interface SensorRecord {
    id: string;
    serial_number: string;
    name: string | null;
    parameter_id: string | null;
    is_active: boolean;
    is_lab_instrument: boolean;
}

interface SiteParameterRecord {
    id: string;
    name: string;
    site_id: string;
    parameter_id: string;
    display_units: string | null;
    is_active: boolean;
}

interface SiteRecord {
    id: string;
    name: string;
}

interface SensorDeploymentRecord {
    id: string;
    sensor_id: string;
    site_id: string;
    deployed_from: string;
    deployed_until: string | null;
    deployment_type: string | null;
    notes: string | null;
}

interface ParameterRecord {
    id: string;
    name: string;
    display_name: string | null;
}

/**
 * Dedicated route for moving / deploying / recalling a sensor.
 *
 * Routes:
 *   /admin/sensors/:id/move        — single-sensor move/deploy
 *   /admin/sensors/move?ids=...    — bulk variant (same parameter only)
 *
 * One screen, three clicks: pick target site → confirm datetime → submit.
 */
export const MoveSensorPage = () => {
    const navigate = useNavigate();
    const { id: routeId } = useParams<{ id?: string }>();
    const [searchParams] = useSearchParams();
    const bulkIdsParam = searchParams.get('ids');

    const sensorIds = useMemo(() => {
        if (routeId) return [routeId];
        if (bulkIdsParam) return bulkIdsParam.split(',').filter(Boolean);
        return [];
    }, [routeId, bulkIdsParam]);

    const isBulk = sensorIds.length > 1;
    const primaryId = sensorIds[0];

    if (!primaryId) {
        return (
            <Box sx={{ p: 3 }}>
                <Title title="Move Sensor" />
                <Alert severity="error">No sensor selected.</Alert>
                <Button onClick={() => navigate(-1)} sx={{ mt: 2 }} startIcon={<ArrowBackIcon />}>
                    Go back
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Title title={isBulk ? 'Move Sensors' : 'Move Sensor'} />
            <Button
                onClick={() => navigate(-1)}
                startIcon={<ArrowBackIcon />}
                sx={{ mb: 2 }}
            >
                Back
            </Button>
            <MoveSensorForm sensorIds={sensorIds} onDone={() => navigate('/admin/sensors')} />
        </Box>
    );
};

interface MoveSensorFormProps {
    sensorIds: string[];
    onDone: () => void;
}

function MoveSensorForm({ sensorIds, onDone }: MoveSensorFormProps) {
    const isBulk = sensorIds.length > 1;
    const primaryId = sensorIds[0];

    const { data: primarySensor, isLoading: sensorLoading } = useGetOne<SensorRecord>(
        'sensors',
        { id: primaryId },
    );

    // Parameter info for display
    const { data: parameter } = useGetOne<ParameterRecord>(
        'parameters',
        { id: primarySensor?.parameter_id ?? '' },
        { enabled: !!primarySensor?.parameter_id },
    );

    // Active deployment (if any) — to know whether this is a move or first-time deploy
    const { data: deployments } = useGetList<SensorDeploymentRecord>(
        'sensor_deployments',
        {
            filter: { sensor_id: primaryId, deployed_until: null },
            pagination: { page: 1, perPage: 5 },
            sort: { field: 'deployed_from', order: 'DESC' },
        },
        { enabled: !!primaryId },
    );
    const activeDeployment = deployments?.find((d) => d.deployed_until === null);

    // Eligible site_parameters: matching parameter_id and active
    const { data: eligibleParams, isLoading: paramsLoading } = useGetList<SiteParameterRecord>(
        'site_parameters',
        {
            filter: { parameter_id: primarySensor?.parameter_id, is_active: true },
            pagination: { page: 1, perPage: 200 },
            sort: { field: 'name', order: 'ASC' },
        },
        { enabled: !!primarySensor?.parameter_id },
    );

    // Sites for the eligible site_parameters
    const eligibleSiteIds = useMemo(
        () => Array.from(new Set((eligibleParams ?? []).map((sp) => sp.site_id))),
        [eligibleParams],
    );
    const { data: sites } = useGetList<SiteRecord>(
        'sites',
        {
            filter: {},
            pagination: { page: 1, perPage: 200 },
            sort: { field: 'name', order: 'ASC' },
        },
    );
    const eligibleSites = useMemo(
        () => (sites ?? []).filter((s) => eligibleSiteIds.includes(s.id)),
        [sites, eligibleSiteIds],
    );

    // Currently-active deployments at each site (for "will replace" callout)
    const { data: activeAtSites } = useGetList<SensorDeploymentRecord>(
        'sensor_deployments',
        {
            filter: { deployed_until: null },
            pagination: { page: 1, perPage: 500 },
            sort: { field: 'deployed_from', order: 'DESC' },
        },
    );
    const activeBySite = useMemo(() => {
        const map: Record<string, SensorDeploymentRecord> = {};
        (activeAtSites ?? []).forEach((d) => {
            if (!map[d.site_id]) map[d.site_id] = d;
        });
        return map;
    }, [activeAtSites]);

    // Form state
    const [targetSiteId, setTargetSiteId] = useState<string>('');
    const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 16));
    const [notes, setNotes] = useState('');

    const [update, { isPending: updatePending }] = useUpdate();
    const [create, { isPending: createPending }] = useCreate();
    const notify = useNotify();
    const submitting = updatePending || createPending;

    const isDeployMode = !activeDeployment;
    const primaryLabel = isDeployMode ? 'Deploy sensor' : 'Move sensor';

    const handleSubmit = async () => {
        if (!targetSiteId) return;
        const effectiveIso = new Date(effectiveFrom).toISOString();

        // Step 1: end old deployment (if move)
        if (activeDeployment) {
            await new Promise<void>((resolve, reject) => {
                update(
                    'sensor_deployments',
                    {
                        id: activeDeployment.id,
                        data: {
                            deployed_until: effectiveIso,
                            notes: notes
                                ? `${activeDeployment.notes ? activeDeployment.notes + '; ' : ''}${notes}`
                                : activeDeployment.notes,
                        },
                        previousData: activeDeployment,
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: () => reject(new Error('end-failed')),
                    },
                );
            }).catch(() => {
                notify("Couldn't end current deployment", { type: 'error' });
                throw new Error('halted');
            });
        }

        // Step 2: create new deployment
        try {
            await new Promise<void>((resolve, reject) => {
                create(
                    'sensor_deployments',
                    {
                        data: {
                            sensor_id: primaryId,
                            site_id: targetSiteId,
                            deployed_from: effectiveIso,
                            deployed_until: null,
                            deployment_type: activeDeployment?.deployment_type ?? 'permanent',
                            notes: notes || null,
                        },
                    },
                    {
                        onSuccess: () => resolve(),
                        onError: () => reject(new Error('create-failed')),
                    },
                );
            });
            notify(isDeployMode ? 'Sensor deployed' : 'Sensor moved', { type: 'success' });
            onDone();
        } catch {
            notify(
                isDeployMode
                    ? 'Failed to deploy sensor'
                    : 'Recalled, but could not redeploy. Sensor is now undeployed.',
                { type: 'error' },
            );
        }
    };

    const handleRecallOnly = async () => {
        if (!activeDeployment) return;
        const effectiveIso = new Date(effectiveFrom).toISOString();
        await new Promise<void>((resolve, reject) => {
            update(
                'sensor_deployments',
                {
                    id: activeDeployment.id,
                    data: {
                        deployed_until: effectiveIso,
                        notes: notes
                            ? `${activeDeployment.notes ? activeDeployment.notes + '; ' : ''}${notes}`
                            : activeDeployment.notes,
                    },
                    previousData: activeDeployment,
                },
                {
                    onSuccess: () => resolve(),
                    onError: () => reject(new Error('recall-failed')),
                },
            );
        }).catch(() => {
            notify('Failed to recall sensor', { type: 'error' });
            return;
        });
        notify('Sensor recalled', { type: 'success' });
        onDone();
    };

    if (sensorLoading) return <Loading />;
    if (!primarySensor) {
        return <Alert severity="error">Sensor not found.</Alert>;
    }
    if (isBulk) {
        return (
            <Alert severity="info">
                Bulk move support coming soon. Move one sensor at a time for now.
            </Alert>
        );
    }

    const currentSiteName = activeDeployment
        ? eligibleSites.find((s) => s.id === activeDeployment.site_id)?.name ??
          sites?.find((s) => s.id === activeDeployment.site_id)?.name ??
          '...'
        : null;

    const replaceTarget = targetSiteId ? activeBySite[targetSiteId] : undefined;
    const replaceWillHappen = replaceTarget && replaceTarget.sensor_id !== primaryId;

    return (
        <Stack spacing={3} sx={{ maxWidth: 720 }}>
            {/* Context card */}
            <Card variant="outlined">
                <CardContent>
                    <Stack direction="row" spacing={2} alignItems="center">
                        <SensorStatusPin status={isDeployMode ? 'undeployed' : 'healthy'} />
                        <Box>
                            <Typography variant="subtitle1" fontWeight={600}>
                                {primarySensor.serial_number}
                                {primarySensor.name ? ` / ${primarySensor.name}` : ''}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Measures {parameter?.display_name ?? parameter?.name ?? 'unknown parameter'}
                                {currentSiteName && ` · Currently at ${currentSiteName}`}
                                {!currentSiteName && ' · Not currently deployed'}
                            </Typography>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>

            {/* Target site picker */}
            <Box>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    {isDeployMode ? 'Deploy to' : 'Move to'}
                </Typography>
                {paramsLoading && <CircularProgress size={20} />}
                {!paramsLoading && eligibleSites.length === 0 && (
                    <Alert severity="info">
                        No site currently has a parameter slot for{' '}
                        <strong>
                            {parameter?.display_name ?? parameter?.name ?? 'this parameter'}
                        </strong>
                        . Add one to a site first via Sites → Site detail → Add Parameter.
                    </Alert>
                )}
                {!paramsLoading && eligibleSites.length > 0 && (
                    <Card variant="outlined">
                        <MuiList disablePadding>
                            {eligibleSites
                                .filter(
                                    (s) =>
                                        !activeDeployment ||
                                        s.id !== activeDeployment.site_id,
                                )
                                .map((site, idx) => {
                                    const occupant = activeBySite[site.id];
                                    const willReplace =
                                        occupant && occupant.sensor_id !== primaryId;
                                    return (
                                        <ListItemButton
                                            key={site.id}
                                            selected={targetSiteId === site.id}
                                            onClick={() => setTargetSiteId(site.id)}
                                            divider={idx < eligibleSites.length - 1}
                                        >
                                            <ListItemText
                                                primary={site.name}
                                                secondary={
                                                    willReplace
                                                        ? `Will replace existing sensor`
                                                        : occupant
                                                          ? 'Currently empty'
                                                          : 'No active sensor'
                                                }
                                            />
                                        </ListItemButton>
                                    );
                                })}
                        </MuiList>
                    </Card>
                )}
            </Box>

            {replaceWillHappen && (
                <Alert severity="warning">
                    The selected site already has an active sensor on this parameter.
                    Submitting will recall it at the same effective date.
                </Alert>
            )}

            {/* Datetime + notes */}
            <Stack spacing={2}>
                <TextField
                    label="Effective from"
                    type="datetime-local"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    helperText="Defaults to now. Adjust to trim noisy readings around physical handling."
                    fullWidth
                />
                <TextField
                    label="Notes (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    multiline
                    rows={2}
                    fullWidth
                    placeholder="Reason for the move, field notes, etc."
                />
            </Stack>

            {/* Actions */}
            <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button onClick={onDone} disabled={submitting}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="primary"
                    disabled={submitting || !targetSiteId}
                    onClick={handleSubmit}
                    startIcon={submitting ? <CircularProgress size={14} /> : undefined}
                >
                    {primaryLabel}
                </Button>
            </Stack>

            {/* Recall-only alternative */}
            {!isDeployMode && (
                <>
                    <Divider>or</Divider>
                    <Stack direction="row" justifyContent="center">
                        <Button
                            color="warning"
                            disabled={submitting}
                            onClick={handleRecallOnly}
                        >
                            Remove from site (recall, no new deployment)
                        </Button>
                    </Stack>
                </>
            )}
        </Stack>
    );
}
