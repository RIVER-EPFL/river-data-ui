import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    useGetOne,
    useGetList,
    useCreate,
    useUpdate,
    useNotify,
    useRefresh,
    Title,
    Loading,
} from 'react-admin';
import {
    Box,
    Card,
    CardHeader,
    CardContent,
    CardActions,
    Typography,
    Grid2 as Grid,
    Chip,
    Button,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Tooltip,
    CircularProgress,
    Divider,
    Alert,
    MenuItem,
    Stepper,
    Step,
    StepLabel,
} from '@mui/material';
import SensorsIcon from '@mui/icons-material/Sensors';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import FunctionsIcon from '@mui/icons-material/Functions';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import { useParams, Link } from 'react-router-dom';
import { useRiverDataProvider } from '../../useRiverDataProvider';

// ---------------------------------------------------------------------------
// Types
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

interface ParameterRecord {
    id: string;
    name: string;
    site_id: string;
    parameter_type_id: string;
    sensor_type: string | null;
    display_units: string | null;
    is_active: boolean;
    is_derived: boolean;
    derived_definition_id: string | null;
    sample_interval_sec: number | null;
}

interface SensorDeploymentRecord {
    id: string;
    sensor_id: string;
    parameter_id: string;
    deployed_from: string;
    deployed_until: string | null;
    deployment_type: string | null;
    notes: string | null;
}

interface SensorRecord {
    id: string;
    serial_number: string;
    name: string | null;
    manufacturer: string | null;
    model: string | null;
    is_active: boolean;
}

interface AlarmThresholdRecord {
    id: string;
    parameter_id: string;
    warning_min: number | null;
    warning_max: number | null;
    alarm_min: number | null;
    alarm_max: number | null;
    description: string | null;
}

interface SensorCalibrationRecord {
    id: string;
    sensor_id: string;
    slope: number;
    intercept: number;
    valid_from: string;
    performed_by: string | null;
    notes: string | null;
}

interface DerivedParameterRecord {
    id: string;
    name: string;
    formula: string;
    display_name: string | null;
    units: string | null;
    description: string | null;
}

interface ProjectRecord {
    id: string;
    name: string;
}

// Group: sensor_id -> list of deployments
interface SensorGroup {
    sensorId: string;
    sensor: SensorRecord | undefined;
    deployments: SensorDeploymentRecord[];
    parameters: ParameterRecord[];
}

// Latest reading for a parameter
interface LatestReading {
    value: number;
    time: string;
}

// Readings API response shape
interface ReadingsApiResponse {
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
// Latest Value component (replaces MiniSparkline)
// ---------------------------------------------------------------------------

function formatRelativeTime(isoTime: string): string {
    const now = Date.now();
    const then = new Date(isoTime).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

const LatestValue: React.FC<{
    reading: LatestReading | undefined;
    units: string | null;
}> = ({ reading, units }) => {
    if (!reading) {
        return (
            <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                No data
            </Typography>
        );
    }

    const displayValue = Number.isInteger(reading.value)
        ? reading.value.toString()
        : reading.value.toFixed(2);
    const relativeTime = formatRelativeTime(reading.time);
    const absoluteTime = new Date(reading.time).toLocaleString();

    return (
        <Tooltip title={`${absoluteTime} (${relativeTime})`}>
            <Typography variant="body2" fontWeight="bold" sx={{ whiteSpace: 'nowrap' }}>
                {displayValue} {units ?? ''}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                    ({relativeTime})
                </Typography>
            </Typography>
        </Tooltip>
    );
};

// ---------------------------------------------------------------------------
// Alarm status helpers
// ---------------------------------------------------------------------------

type AlarmLevel = 'ok' | 'warning' | 'alarm' | 'unknown';

function getAlarmLevel(threshold: AlarmThresholdRecord | undefined, value?: number): AlarmLevel {
    if (!threshold) return 'unknown';

    const hasWarning = threshold.warning_min != null || threshold.warning_max != null;
    const hasAlarm = threshold.alarm_min != null || threshold.alarm_max != null;
    if (!hasWarning && !hasAlarm) return 'unknown';

    // No live value available - cannot evaluate
    if (value === undefined) return 'unknown';

    // Check alarm thresholds first (higher severity)
    if (threshold.alarm_min != null && value < threshold.alarm_min) return 'alarm';
    if (threshold.alarm_max != null && value > threshold.alarm_max) return 'alarm';

    // Check warning thresholds
    if (threshold.warning_min != null && value < threshold.warning_min) return 'warning';
    if (threshold.warning_max != null && value > threshold.warning_max) return 'warning';

    return 'ok';
}

function AlarmDot({ level }: { level: AlarmLevel }) {
    switch (level) {
        case 'ok':
            return (
                <Tooltip title="OK - within thresholds">
                    <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                </Tooltip>
            );
        case 'warning':
            return (
                <Tooltip title="Warning threshold exceeded">
                    <WarningAmberIcon sx={{ color: 'warning.main', fontSize: 20 }} />
                </Tooltip>
            );
        case 'alarm':
            return (
                <Tooltip title="Alarm threshold exceeded">
                    <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                </Tooltip>
            );
        default:
            return (
                <Tooltip title="No thresholds configured">
                    <CheckCircleIcon sx={{ color: 'action.disabled', fontSize: 20 }} />
                </Tooltip>
            );
    }
}

// ---------------------------------------------------------------------------
// Calibrate Dialog
// ---------------------------------------------------------------------------

interface CalibrateDialogProps {
    open: boolean;
    onClose: () => void;
    sensorId: string;
    sensorSerial: string;
}

const CalibrateDialog: React.FC<CalibrateDialogProps> = ({ open, onClose, sensorId, sensorSerial }) => {
    const [create, { isPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [slope, setSlope] = useState('1');
    const [intercept, setIntercept] = useState('0');
    const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 16));
    const [performedBy, setPerformedBy] = useState('');
    const [notes, setNotes] = useState('');

    const handleSubmit = () => {
        create(
            'sensor_calibrations',
            {
                data: {
                    sensor_id: sensorId,
                    slope: parseFloat(slope),
                    intercept: parseFloat(intercept),
                    valid_from: new Date(validFrom).toISOString(),
                    performed_by: performedBy || null,
                    notes: notes || null,
                },
            },
            {
                onSuccess: () => {
                    notify('Calibration created', { type: 'success' });
                    refresh();
                    onClose();
                },
                onError: () => {
                    notify('Failed to create calibration', { type: 'error' });
                },
            },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Calibrate Sensor: {sensorSerial}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                    label="Slope"
                    type="number"
                    value={slope}
                    onChange={(e) => setSlope(e.target.value)}
                    inputProps={{ step: 'any' }}
                    fullWidth
                    size="small"
                />
                <TextField
                    label="Intercept"
                    type="number"
                    value={intercept}
                    onChange={(e) => setIntercept(e.target.value)}
                    inputProps={{ step: 'any' }}
                    fullWidth
                    size="small"
                />
                <TextField
                    label="Valid From"
                    type="datetime-local"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    fullWidth
                    size="small"
                    slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                    label="Performed By"
                    value={performedBy}
                    onChange={(e) => setPerformedBy(e.target.value)}
                    fullWidth
                    size="small"
                />
                <TextField
                    label="Notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    multiline
                    rows={2}
                    fullWidth
                    size="small"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    Save Calibration
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Move Sensor Dialog (with two-step workflow)
// ---------------------------------------------------------------------------

interface MoveSensorDialogProps {
    open: boolean;
    onClose: () => void;
    deployment: SensorDeploymentRecord;
    sensorSerial: string;
    currentSiteName: string;
}

type MoveStep = 1 | 2 | 'done';

const MoveSensorDialog: React.FC<MoveSensorDialogProps> = ({
    open,
    onClose,
    deployment,
    sensorSerial,
    currentSiteName,
}) => {
    const [update, { isPending: updatePending }] = useUpdate();
    const [create, { isPending: createPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [step, setStep] = useState<MoveStep>(1);
    const [deployedUntil, setDeployedUntil] = useState(new Date().toISOString().slice(0, 16));
    const [movNotes, setMovNotes] = useState('');

    // Step 2 fields
    const [targetSiteId, setTargetSiteId] = useState('');
    const [targetParameterId, setTargetParameterId] = useState('');
    const [newDeployedFrom, setNewDeployedFrom] = useState('');
    const [newDeployNotes, setNewDeployNotes] = useState('');

    // Fetch sites for step 2
    const { data: allSites } = useGetList<SiteRecord>('sites', {
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: step === 2 });

    // Fetch parameters for selected target site
    const { data: targetParams } = useGetList<ParameterRecord>('parameters', {
        filter: { site_id: targetSiteId },
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: step === 2 && !!targetSiteId });

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setStep(1);
            setDeployedUntil(new Date().toISOString().slice(0, 16));
            setMovNotes('');
            setTargetSiteId('');
            setTargetParameterId('');
            setNewDeployedFrom('');
            setNewDeployNotes('');
        }
    }, [open]);

    // Reset target parameter when target site changes
    useEffect(() => {
        setTargetParameterId('');
    }, [targetSiteId]);

    const handleEndDeployment = () => {
        const endTime = new Date(deployedUntil).toISOString();
        update(
            'sensor_deployments',
            {
                id: deployment.id,
                data: {
                    ...deployment,
                    deployed_until: endTime,
                    notes: movNotes
                        ? `${deployment.notes ? deployment.notes + '; ' : ''}${movNotes}`
                        : deployment.notes,
                },
                previousData: deployment,
            },
            {
                onSuccess: () => {
                    notify('Deployment ended successfully', { type: 'success' });
                    refresh();
                    setNewDeployedFrom(deployedUntil);
                    setStep(2);
                },
                onError: () => {
                    notify('Failed to end deployment', { type: 'error' });
                },
            },
        );
    };

    const handleCreateDeployment = () => {
        create(
            'sensor_deployments',
            {
                data: {
                    sensor_id: deployment.sensor_id,
                    parameter_id: targetParameterId,
                    deployed_from: new Date(newDeployedFrom).toISOString(),
                    deployed_until: null,
                    deployment_type: deployment.deployment_type,
                    notes: newDeployNotes || null,
                },
            },
            {
                onSuccess: () => {
                    notify('New deployment created', { type: 'success' });
                    refresh();
                    setStep('done');
                },
                onError: () => {
                    notify('Failed to create new deployment', { type: 'error' });
                },
            },
        );
    };

    const handleClose = () => {
        onClose();
    };

    const activeStep = step === 1 ? 0 : step === 2 ? 1 : 2;

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Move Sensor: {sensorSerial}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <Stepper activeStep={activeStep} sx={{ mb: 2 }}>
                    <Step completed={step !== 1}>
                        <StepLabel>End Current Deployment</StepLabel>
                    </Step>
                    <Step completed={step === 'done'}>
                        <StepLabel>Create New Deployment</StepLabel>
                    </Step>
                </Stepper>

                {step === 1 && (
                    <>
                        <Alert severity="info" sx={{ mb: 1 }}>
                            Step 1: End the current deployment at {currentSiteName}.
                        </Alert>
                        <TextField
                            label="Deployed Until"
                            type="datetime-local"
                            value={deployedUntil}
                            onChange={(e) => setDeployedUntil(e.target.value)}
                            fullWidth
                            size="small"
                            slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                            label="Notes"
                            value={movNotes}
                            onChange={(e) => setMovNotes(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
                            size="small"
                            placeholder="Reason for moving..."
                        />
                    </>
                )}

                {step === 2 && (
                    <>
                        <Alert severity="success" sx={{ mb: 1 }}>
                            Deployment ended. Now create a new deployment for this sensor.
                        </Alert>
                        <TextField
                            select
                            label="Target Site"
                            value={targetSiteId}
                            onChange={(e) => setTargetSiteId(e.target.value)}
                            fullWidth
                            size="small"
                        >
                            {(allSites ?? []).map((s) => (
                                <MenuItem key={s.id} value={s.id}>
                                    {s.name}
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            select
                            label="Target Parameter"
                            value={targetParameterId}
                            onChange={(e) => setTargetParameterId(e.target.value)}
                            fullWidth
                            size="small"
                            disabled={!targetSiteId}
                            helperText={!targetSiteId ? 'Select a site first' : undefined}
                        >
                            {(targetParams ?? []).map((p) => (
                                <MenuItem key={p.id} value={p.id}>
                                    {p.name} ({p.display_units ?? 'N/A'})
                                </MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            label="Deployed From"
                            type="datetime-local"
                            value={newDeployedFrom}
                            onChange={(e) => setNewDeployedFrom(e.target.value)}
                            fullWidth
                            size="small"
                            slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                            label="Notes"
                            value={newDeployNotes}
                            onChange={(e) => setNewDeployNotes(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
                            size="small"
                            placeholder="Deployment notes..."
                        />
                    </>
                )}

                {step === 'done' && (
                    <Alert severity="success">
                        Sensor moved successfully. The new deployment has been created.
                    </Alert>
                )}
            </DialogContent>
            <DialogActions>
                {step === 1 && (
                    <>
                        <Button onClick={handleClose} disabled={updatePending}>Cancel</Button>
                        <Button
                            onClick={handleEndDeployment}
                            variant="contained"
                            color="warning"
                            disabled={updatePending}
                            startIcon={updatePending ? <CircularProgress size={16} /> : undefined}
                        >
                            End Deployment
                        </Button>
                    </>
                )}
                {step === 2 && (
                    <>
                        <Button onClick={handleClose}>
                            Skip — I'll do this later
                        </Button>
                        <Button
                            onClick={handleCreateDeployment}
                            variant="contained"
                            disabled={createPending || !targetSiteId || !targetParameterId || !newDeployedFrom}
                            startIcon={createPending ? <CircularProgress size={16} /> : undefined}
                        >
                            Create Deployment
                        </Button>
                    </>
                )}
                {step === 'done' && (
                    <Button onClick={handleClose} variant="contained">
                        Close
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Inline Editable Threshold
// ---------------------------------------------------------------------------

interface InlineThresholdProps {
    threshold: AlarmThresholdRecord;
}

const InlineThreshold: React.FC<InlineThresholdProps> = ({ threshold }) => {
    const [editing, setEditing] = useState(false);
    const [update, { isPending }] = useUpdate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [warnMin, setWarnMin] = useState(String(threshold.warning_min ?? ''));
    const [warnMax, setWarnMax] = useState(String(threshold.warning_max ?? ''));
    const [alarmMin, setAlarmMin] = useState(String(threshold.alarm_min ?? ''));
    const [alarmMax, setAlarmMax] = useState(String(threshold.alarm_max ?? ''));

    const handleSave = () => {
        const toNum = (v: string) => (v === '' ? null : parseFloat(v));
        update(
            'alarm_thresholds',
            {
                id: threshold.id,
                data: {
                    ...threshold,
                    warning_min: toNum(warnMin),
                    warning_max: toNum(warnMax),
                    alarm_min: toNum(alarmMin),
                    alarm_max: toNum(alarmMax),
                },
                previousData: threshold,
            },
            {
                onSuccess: () => {
                    notify('Thresholds updated', { type: 'success' });
                    setEditing(false);
                    refresh();
                },
                onError: () => {
                    notify('Failed to update thresholds', { type: 'error' });
                },
            },
        );
    };

    if (!editing) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary">
                    Warn: [{threshold.warning_min ?? '-'}, {threshold.warning_max ?? '-'}]
                    {' | '}
                    Alarm: [{threshold.alarm_min ?? '-'}, {threshold.alarm_max ?? '-'}]
                </Typography>
                <Tooltip title="Edit thresholds">
                    <IconButton size="small" onClick={() => setEditing(true)}>
                        <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                </Tooltip>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <TextField label="W min" size="small" type="number" value={warnMin}
                onChange={(e) => setWarnMin(e.target.value)} sx={{ width: 70 }}
                inputProps={{ step: 'any' }} />
            <TextField label="W max" size="small" type="number" value={warnMax}
                onChange={(e) => setWarnMax(e.target.value)} sx={{ width: 70 }}
                inputProps={{ step: 'any' }} />
            <TextField label="A min" size="small" type="number" value={alarmMin}
                onChange={(e) => setAlarmMin(e.target.value)} sx={{ width: 70 }}
                inputProps={{ step: 'any' }} />
            <TextField label="A max" size="small" type="number" value={alarmMax}
                onChange={(e) => setAlarmMax(e.target.value)} sx={{ width: 70 }}
                inputProps={{ step: 'any' }} />
            <Button size="small" onClick={handleSave} disabled={isPending} variant="outlined">
                {isPending ? <CircularProgress size={14} /> : 'Save'}
            </Button>
            <Button size="small" onClick={() => setEditing(false)} disabled={isPending}>
                Cancel
            </Button>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// Sensor Card
// ---------------------------------------------------------------------------

interface SensorCardProps {
    group: SensorGroup;
    thresholdsByParam: Map<string, AlarmThresholdRecord>;
    latestByParam: Map<string, LatestReading>;
    siteName: string;
}

const SensorCard: React.FC<SensorCardProps> = ({ group, thresholdsByParam, latestByParam, siteName }) => {
    const [calibrateOpen, setCalibrateOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);

    const sensor = group.sensor;
    const activeDeployment = group.deployments.find((d) => !d.deployed_until);
    const deployedSince = activeDeployment
        ? new Date(activeDeployment.deployed_from).toLocaleDateString()
        : 'Unknown';

    return (
        <>
            <Card variant="outlined" sx={{ height: '100%' }}>
                <CardHeader
                    avatar={<SensorsIcon color="primary" />}
                    title={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle1" fontWeight="bold">
                                {sensor?.serial_number ?? 'Unknown Sensor'}
                            </Typography>
                            {sensor?.is_active === false && (
                                <Chip label="Inactive" size="small" color="default" />
                            )}
                        </Box>
                    }
                    subheader={
                        <>
                            {sensor?.model && `${sensor.manufacturer ?? ''} ${sensor.model}`.trim()}
                            {sensor?.model && ' | '}
                            Deployed since: {deployedSince}
                        </>
                    }
                    sx={{ pb: 0 }}
                />
                <CardContent sx={{ pt: 1 }}>
                    {group.parameters.map((param) => {
                        const threshold = thresholdsByParam.get(param.id);
                        const latest = latestByParam.get(param.id);
                        const alarmLevel = getAlarmLevel(threshold, latest?.value);

                        return (
                            <Box key={param.id} sx={{ mb: 1.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                    <AlarmDot level={alarmLevel} />
                                    <Typography variant="body2" fontWeight="medium">
                                        {param.name}
                                    </Typography>
                                    <Chip
                                        label={param.sensor_type ?? 'N/A'}
                                        size="small"
                                        variant="outlined"
                                        sx={{ fontSize: '0.7rem' }}
                                    />
                                    <Typography variant="caption" color="text.secondary">
                                        {param.display_units ?? ''}
                                    </Typography>
                                    <Chip
                                        label={param.is_active ? 'Active' : 'Inactive'}
                                        size="small"
                                        color={param.is_active ? 'success' : 'default'}
                                        sx={{ fontSize: '0.65rem', height: 18 }}
                                    />
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 3.5 }}>
                                    <LatestValue reading={latest} units={param.display_units} />
                                    {threshold && <InlineThreshold threshold={threshold} />}
                                    {!threshold && (
                                        <Typography variant="caption" color="text.secondary">
                                            No thresholds set
                                        </Typography>
                                    )}
                                </Box>
                                {group.parameters.indexOf(param) < group.parameters.length - 1 && (
                                    <Divider sx={{ mt: 1.5 }} />
                                )}
                            </Box>
                        );
                    })}
                </CardContent>
                <CardActions sx={{ pt: 0 }}>
                    <Button
                        size="small"
                        startIcon={<TuneIcon />}
                        onClick={() => setCalibrateOpen(true)}
                        disabled={!sensor}
                    >
                        Calibrate
                    </Button>
                    <Button
                        size="small"
                        startIcon={<SwapHorizIcon />}
                        onClick={() => setMoveOpen(true)}
                        disabled={!activeDeployment}
                    >
                        Move Sensor
                    </Button>
                    {sensor && (
                        <Button
                            size="small"
                            component={Link}
                            to={`/admin/sensors/${sensor.id}/show`}
                        >
                            View Sensor
                        </Button>
                    )}
                </CardActions>
            </Card>

            {sensor && (
                <CalibrateDialog
                    open={calibrateOpen}
                    onClose={() => setCalibrateOpen(false)}
                    sensorId={sensor.id}
                    sensorSerial={sensor.serial_number}
                />
            )}

            {activeDeployment && (
                <MoveSensorDialog
                    open={moveOpen}
                    onClose={() => setMoveOpen(false)}
                    deployment={activeDeployment}
                    sensorSerial={sensor?.serial_number ?? 'Unknown'}
                    currentSiteName={siteName}
                />
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// Derived Parameters Section
// ---------------------------------------------------------------------------

interface DerivedSectionProps {
    derivedParams: ParameterRecord[];
    derivedDefs: Map<string, DerivedParameterRecord>;
}

const DerivedSection: React.FC<DerivedSectionProps> = ({ derivedParams, derivedDefs }) => {
    const dataProvider = useRiverDataProvider();
    const notify = useNotify();
    const refresh = useRefresh();
    const [recomputing, setRecomputing] = useState<string | null>(null);

    const handleRecompute = useCallback(async (defId: string) => {
        setRecomputing(defId);
        try {
            await dataProvider.recomputeDerived(defId);
            notify('Recompute triggered', { type: 'success' });
            refresh();
        } catch {
            notify('Recompute failed', { type: 'error' });
        } finally {
            setRecomputing(null);
        }
    }, [dataProvider, notify, refresh]);

    if (derivedParams.length === 0) return null;

    return (
        <Card variant="outlined" sx={{ mt: 3 }}>
            <CardHeader
                avatar={<FunctionsIcon color="secondary" />}
                title="Derived Parameters"
            />
            <CardContent>
                {derivedParams.map((param) => {
                    const def = param.derived_definition_id
                        ? derivedDefs.get(param.derived_definition_id)
                        : undefined;

                    return (
                        <Box key={param.id} sx={{ mb: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" fontWeight="medium">
                                    {param.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {param.display_units ?? ''}
                                </Typography>
                            </Box>
                            {def && (
                                <Typography
                                    variant="caption"
                                    sx={{ fontFamily: 'monospace', color: 'text.secondary', ml: 1 }}
                                >
                                    Formula: {def.formula}
                                </Typography>
                            )}
                            {def && (
                                <Box sx={{ ml: 1, mt: 0.5 }}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={
                                            recomputing === def.id ? (
                                                <CircularProgress size={14} />
                                            ) : (
                                                <FunctionsIcon />
                                            )
                                        }
                                        onClick={() => handleRecompute(def.id)}
                                        disabled={recomputing === def.id}
                                    >
                                        Recompute
                                    </Button>
                                </Box>
                            )}
                            {!def && param.derived_definition_id && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                    Definition not loaded
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </CardContent>
        </Card>
    );
};

// ---------------------------------------------------------------------------
// Hook: Fetch latest readings for a site
// ---------------------------------------------------------------------------

function useLatestReadings(siteId: string | undefined): Map<string, LatestReading> {
    const [latestByParam, setLatestByParam] = useState<Map<string, LatestReading>>(new Map());

    useEffect(() => {
        if (!siteId) return;

        const now = new Date();
        const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const url = `/api/private/sites/${siteId}/readings?start=${start.toISOString()}&page_size=1000&format=json`;

        fetch(url)
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
// Station Hub (main component)
// ---------------------------------------------------------------------------

const StationHub = () => {
    const { id } = useParams<{ id: string }>();

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
    } = useGetList<ParameterRecord>('parameters', {
        filter: { site_id: id },
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: !!id });

    // Item 1: Collect parameter IDs for filtered fetching
    const parameterIds = useMemo(
        () => (parameters ?? []).map((p) => p.id),
        [parameters],
    );

    // Fetch sensor deployments filtered by this site's parameter IDs
    // TODO: Add server-side filtering when crudcrate supports IN-array filters
    const {
        data: deployments,
        isPending: deploymentsLoading,
    } = useGetList<SensorDeploymentRecord>('sensor_deployments', {
        filter: { parameter_id: parameterIds },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'deployed_from', order: 'DESC' },
    }, { enabled: parameterIds.length > 0 });

    // Fetch alarm thresholds filtered by this site's parameter IDs
    // TODO: Add server-side filtering when crudcrate supports IN-array filters
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
    // TODO: Add server-side filtering when crudcrate supports IN-array filters
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

    // Item 2: Fetch latest readings for this site
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
    const sensorGroups = useMemo(() => {
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

    // Derived parameters
    const derivedParams = useMemo(
        () => (parameters ?? []).filter((p) => p.is_derived),
        [parameters],
    );

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
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Tooltip title="Back to sites list">
                            <IconButton component={Link} to="/admin/sites" size="small">
                                <ArrowBackIcon />
                            </IconButton>
                        </Tooltip>
                        <Typography variant="h5" fontWeight="bold">
                            {site.name}
                        </Typography>
                        <Button
                            component={Link}
                            to={`/admin/sites/${site.id}`}
                            size="small"
                            startIcon={<EditIcon />}
                        >
                            Edit
                        </Button>
                    </Box>

                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
                        {project && (
                            <Chip
                                label={`Project: ${project.name}`}
                                component={Link}
                                to={`/admin/projects/${project.id}/show`}
                                clickable
                                color="primary"
                                variant="outlined"
                            />
                        )}
                        {site.latitude != null && site.longitude != null && (
                            <Typography variant="body2" color="text.secondary">
                                {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                                {site.altitude_m != null && ` (${site.altitude_m}m)`}
                            </Typography>
                        )}
                        <Divider orientation="vertical" flexItem />
                        <Chip
                            label={`${statusSummary.total} parameters`}
                            size="small"
                        />
                        <Chip
                            label={`${statusSummary.active} active`}
                            size="small"
                            color="success"
                        />
                        <Chip
                            label={`${statusSummary.sensorsActive} sensors deployed`}
                            size="small"
                            color="info"
                        />
                    </Box>
                </CardContent>
            </Card>

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

            {/* Derived Parameters */}
            <DerivedSection derivedParams={derivedParams} derivedDefs={derivedDefById} />
        </Box>
    );
};

export default StationHub;
