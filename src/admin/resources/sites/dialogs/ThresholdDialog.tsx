import React, { useEffect, useState } from 'react';
import { useCreate, useNotify, useRefresh, useUpdate } from 'react-admin';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
    Typography,
} from '@mui/material';
import type { AlarmThresholdRecord } from '../SensorCard';

interface ThresholdDialogProps {
    open: boolean;
    onClose: () => void;
    threshold?: AlarmThresholdRecord;
    parameterId: string;
    siteId: string;
    parameterName: string;
}

export const ThresholdDialog: React.FC<ThresholdDialogProps> = ({
    open,
    onClose,
    threshold,
    parameterId,
    siteId,
    parameterName,
}) => {
    const [create, { isPending: createPending }] = useCreate();
    const [update, { isPending: updatePending }] = useUpdate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [warnMin, setWarnMin] = useState('');
    const [warnMax, setWarnMax] = useState('');
    const [alarmMin, setAlarmMin] = useState('');
    const [alarmMax, setAlarmMax] = useState('');

    const isPending = createPending || updatePending;
    const isEdit = !!threshold;

    useEffect(() => {
        if (open && threshold) {
            setWarnMin(String(threshold.warning_min ?? ''));
            setWarnMax(String(threshold.warning_max ?? ''));
            setAlarmMin(String(threshold.alarm_min ?? ''));
            setAlarmMax(String(threshold.alarm_max ?? ''));
        } else if (open) {
            setWarnMin('');
            setWarnMax('');
            setAlarmMin('');
            setAlarmMax('');
        }
    }, [open, threshold]);

    const toNum = (v: string) => (v === '' ? null : parseFloat(v));

    const handleSave = () => {
        const values = {
            warning_min: toNum(warnMin),
            warning_max: toNum(warnMax),
            alarm_min: toNum(alarmMin),
            alarm_max: toNum(alarmMax),
        };

        if (isEdit) {
            update(
                'alarm_thresholds',
                {
                    id: threshold.id,
                    data: { ...threshold, ...values },
                    previousData: threshold,
                },
                {
                    onSuccess: () => {
                        notify('Thresholds updated', { type: 'success' });
                        refresh();
                        onClose();
                    },
                    onError: () => {
                        notify('Failed to update thresholds', { type: 'error' });
                    },
                },
            );
        } else {
            create(
                'alarm_thresholds',
                {
                    data: {
                        parameter_id: parameterId,
                        site_id: siteId,
                        alarm_type: 'range',
                        ...values,
                    },
                },
                {
                    onSuccess: () => {
                        notify('Thresholds created', { type: 'success' });
                        refresh();
                        onClose();
                    },
                    onError: () => {
                        notify('Failed to create thresholds', { type: 'error' });
                    },
                },
            );
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle>
                {isEdit ? 'Edit' : 'Set'} Thresholds: {parameterName}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <Typography variant="body2" color="text.secondary">
                    Warning thresholds trigger a yellow alert. Alarm thresholds trigger a red alert.
                    Leave blank to disable a threshold.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        label="Warning Min"
                        type="number"
                        value={warnMin}
                        onChange={(e) => setWarnMin(e.target.value)}
                        fullWidth
                        inputProps={{ step: 'any' }}
                    />
                    <TextField
                        label="Warning Max"
                        type="number"
                        value={warnMax}
                        onChange={(e) => setWarnMax(e.target.value)}
                        fullWidth
                        inputProps={{ step: 'any' }}
                    />
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                        label="Alarm Min"
                        type="number"
                        value={alarmMin}
                        onChange={(e) => setAlarmMin(e.target.value)}
                        fullWidth
                        inputProps={{ step: 'any' }}
                    />
                    <TextField
                        label="Alarm Max"
                        type="number"
                        value={alarmMax}
                        onChange={(e) => setAlarmMax(e.target.value)}
                        fullWidth
                        inputProps={{ step: 'any' }}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isPending}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={isPending}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    {isEdit ? 'Save' : 'Create'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
