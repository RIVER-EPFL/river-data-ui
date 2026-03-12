import React, { useState, useEffect } from 'react';
import {
    useGetList,
    useCreate,
    useUpdate,
    useNotify,
    useRefresh,
} from 'react-admin';
import {
    Box,
    Card,
    CardHeader,
    CardContent,
    CardActions,
    Typography,
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
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import { Link } from 'react-router-dom';
import { CalibrationTimeline } from './CalibrationTimeline';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParameterRecord {
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

export interface SensorDeploymentRecord {
    id: string;
    sensor_id: string;
    parameter_id: string;
    deployed_from: string;
    deployed_until: string | null;
    deployment_type: string | null;
    notes: string | null;
}

export interface SensorRecord {
    id: string;
    serial_number: string;
    name: string | null;
    manufacturer: string | null;
    model: string | null;
    is_active: boolean;
}

export interface AlarmThresholdRecord {
    id: string;
    parameter_id: string;
    warning_min: number | null;
    warning_max: number | null;
    alarm_min: number | null;
    alarm_max: number | null;
    description: string | null;
}

export interface SensorCalibrationRecord {
    id: string;
    sensor_id: string;
    slope: number;
    intercept: number;
    valid_from: string;
    performed_by: string | null;
    notes: string | null;
}

export interface SensorGroup {
    sensorId: string;
    sensor: SensorRecord | undefined;
    deployments: SensorDeploymentRecord[];
    parameters: ParameterRecord[];
}

export interface LatestReading {
    value: number;
    time: string;
}

export type AlarmLevel = 'ok' | 'warning' | 'alarm' | 'unknown';

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Latest Value component
// ---------------------------------------------------------------------------

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

export function getAlarmLevel(threshold: AlarmThresholdRecord | undefined, value?: number): AlarmLevel {
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
    const { data: targetParams } = useGetList<ParameterRecord>('site_parameters', {
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

export const SensorCard: React.FC<SensorCardProps> = ({ group, thresholdsByParam, latestByParam, siteName }) => {
    const [calibrateOpen, setCalibrateOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [recallOpen, setRecallOpen] = useState(false);
    const [recallUpdate, { isPending: recallPending }] = useUpdate();
    const recallNotify = useNotify();
    const recallRefresh = useRefresh();

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
                    <Button
                        size="small"
                        color="warning"
                        startIcon={<HighlightOffIcon />}
                        onClick={() => setRecallOpen(true)}
                        disabled={!activeDeployment}
                    >
                        Recall
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
                {sensor && (
                    <CardContent sx={{ pt: 0 }}>
                        <CalibrationTimeline sensorId={sensor.id} />
                    </CardContent>
                )}
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

            {activeDeployment && (
                <Dialog open={recallOpen} onClose={() => setRecallOpen(false)} maxWidth="xs">
                    <DialogTitle>Recall Sensor: {sensor?.serial_number ?? 'Unknown'}?</DialogTitle>
                    <DialogContent>
                        <Typography variant="body2">
                            This will end the current deployment. The sensor will appear as undeployed.
                        </Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setRecallOpen(false)} disabled={recallPending}>Cancel</Button>
                        <Button
                            onClick={() => {
                                recallUpdate(
                                    'sensor_deployments',
                                    {
                                        id: activeDeployment.id,
                                        data: { ...activeDeployment, deployed_until: new Date().toISOString() },
                                        previousData: activeDeployment,
                                    },
                                    {
                                        onSuccess: () => {
                                            recallNotify(`Sensor recalled`, { type: 'success' });
                                            recallRefresh();
                                            setRecallOpen(false);
                                        },
                                        onError: () => {
                                            recallNotify('Failed to recall sensor', { type: 'error' });
                                        },
                                    },
                                );
                            }}
                            variant="contained"
                            color="warning"
                            disabled={recallPending}
                            startIcon={recallPending ? <CircularProgress size={16} /> : undefined}
                        >
                            Recall
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
        </>
    );
};
