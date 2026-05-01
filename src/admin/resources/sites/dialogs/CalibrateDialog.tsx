import React, { useState } from 'react';
import { useCreate, useNotify, useRefresh } from 'react-admin';
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
} from '@mui/material';

interface CalibrateDialogProps {
    open: boolean;
    onClose: () => void;
    sensorId: string;
    sensorSerial: string;
}

export const CalibrateDialog: React.FC<CalibrateDialogProps> = ({
    open,
    onClose,
    sensorId,
    sensorSerial,
}) => {
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
                />
                <TextField
                    label="Intercept"
                    type="number"
                    value={intercept}
                    onChange={(e) => setIntercept(e.target.value)}
                    inputProps={{ step: 'any' }}
                    fullWidth
                />
                <TextField
                    label="Valid From"
                    type="datetime-local"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                    label="Performed By"
                    value={performedBy}
                    onChange={(e) => setPerformedBy(e.target.value)}
                    fullWidth
                />
                <TextField
                    label="Notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    multiline
                    rows={2}
                    fullWidth
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isPending}>
                    Cancel
                </Button>
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
