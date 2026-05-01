import React, { useState } from 'react';
import {
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
    Tooltip,
    CircularProgress,
} from '@mui/material';
import SensorsIcon from '@mui/icons-material/Sensors';
import TuneIcon from '@mui/icons-material/Tune';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import EditIcon from '@mui/icons-material/Edit';
import { Link } from 'react-router-dom';
import { CalibrationTimeline } from './CalibrationTimeline';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { AlarmDot, type AlarmLevel } from '../../components/AlarmDot';
import { snippets } from '../../themeSnippets';
import { CalibrateDialog } from './dialogs/CalibrateDialog';
import { ThresholdDialog } from './dialogs/ThresholdDialog';
import { RecallPopover } from '../sensors/RecallPopover';

export type { AlarmLevel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParameterRecord {
    id: string;
    name: string;
    site_id: string;
    parameter_id: string;
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
    site_id: string;
    deployed_from: string;
    deployed_until: string | null;
    deployment_type: string | null;
    notes: string | null;
}

export interface SensorRecord {
    id: string;
    serial_number: string;
    name: string | null;
    parameter_id: string | null;
    manufacturer: string | null;
    model: string | null;
    is_active: boolean;
}

export interface AlarmThresholdRecord {
    id: string;
    parameter_id: string;
    site_id: string | null;
    alarm_type: string;
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
    const [thresholdParam, setThresholdParam] = useState<ParameterRecord | null>(null);

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
                            <Box key={param.id} sx={snippets.tightCardRow}>
                                <AlarmDot level={alarmLevel} />
                                <Typography variant="body2" fontWeight={600}>
                                    {param.name}
                                </Typography>
                                {param.display_units && (
                                    <Typography variant="caption" color="text.secondary">
                                        ({param.display_units})
                                    </Typography>
                                )}
                                <Tooltip title={param.is_active ? 'Actively monitored' : 'Monitoring paused'}>
                                    <Chip
                                        label={param.is_active ? 'Active' : 'Inactive'}
                                        color={param.is_active ? 'success' : 'default'}
                                    />
                                </Tooltip>
                                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <LatestValue reading={latest} units={param.display_units} />
                                    {threshold ? (
                                        <Tooltip title={`Warn: [${threshold.warning_min ?? '-'}, ${threshold.warning_max ?? '-'}] | Alarm: [${threshold.alarm_min ?? '-'}, ${threshold.alarm_max ?? '-'}]`}>
                                            <IconButton onClick={() => setThresholdParam(param)} sx={{ p: 0.25 }}>
                                                <EditIcon sx={{ fontSize: 14 }} />
                                            </IconButton>
                                        </Tooltip>
                                    ) : (
                                        <Button onClick={() => setThresholdParam(param)}
                                            sx={{ minWidth: 0, py: 0, px: 0.5 }}>
                                            Set Thresholds
                                        </Button>
                                    )}
                                </Box>
                            </Box>
                        );
                    })}
                </CardContent>
                <CardActions sx={{ pt: 0 }}>
                    <Tooltip title={!sensor ? 'Deploy a sensor first' : ''}>
                        <span>
                            <Button
                                size="small"
                                startIcon={<TuneIcon />}
                                onClick={() => setCalibrateOpen(true)}
                                disabled={!sensor}
                            >
                                Calibrate
                            </Button>
                        </span>
                    </Tooltip>
                    <Tooltip title={!sensor ? 'No sensor to move' : ''}>
                        <span>
                            <Button
                                size="small"
                                startIcon={<SwapHorizIcon />}
                                component={Link}
                                to={sensor ? `/admin/sensors/${sensor.id}/move` : '#'}
                                disabled={!sensor}
                            >
                                Move Sensor
                            </Button>
                        </span>
                    </Tooltip>
                    {activeDeployment && sensor ? (
                        <RecallPopover
                            deploymentId={activeDeployment.id}
                            sensorSerial={sensor.serial_number}
                            siteName={siteName}
                            existingNotes={activeDeployment.notes}
                            trigger={
                                <Button startIcon={<HighlightOffIcon />} color="warning">
                                    Recall
                                </Button>
                            }
                        />
                    ) : (
                        <Tooltip title="No active deployment to recall">
                            <span>
                                <Button startIcon={<HighlightOffIcon />} color="warning" disabled>
                                    Recall
                                </Button>
                            </span>
                        </Tooltip>
                    )}
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

            {thresholdParam && (
                <ThresholdDialog
                    open={!!thresholdParam}
                    onClose={() => setThresholdParam(null)}
                    threshold={thresholdsByParam.get(thresholdParam.id)}
                    parameterId={thresholdParam.id}
                    siteId={thresholdParam.site_id}
                    parameterName={thresholdParam.name}
                />
            )}

        </>
    );
};
