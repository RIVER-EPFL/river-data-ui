import React, { useEffect, useState } from 'react';
import { useCreate, useGetList, useNotify, useRefresh, useUpdate } from 'react-admin';
import {
    Alert,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Step,
    StepLabel,
    Stepper,
    TextField,
} from '@mui/material';
import type { ParameterRecord, SensorDeploymentRecord } from '../SensorCard';

interface SiteRecord {
    id: string;
    name: string;
}

interface MoveSensorDialogProps {
    open: boolean;
    onClose: () => void;
    deployment: SensorDeploymentRecord;
    sensorSerial: string;
    currentSiteName: string;
}

type MoveStep = 1 | 2 | 'done';

export const MoveSensorDialog: React.FC<MoveSensorDialogProps> = ({
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

    const [targetSiteId, setTargetSiteId] = useState('');
    const [targetParameterId, setTargetParameterId] = useState('');
    const [newDeployedFrom, setNewDeployedFrom] = useState('');
    const [newDeployNotes, setNewDeployNotes] = useState('');

    const { data: allSites } = useGetList<SiteRecord>(
        'sites',
        { pagination: { page: 1, perPage: 100 }, sort: { field: 'name', order: 'ASC' } },
        { enabled: step === 2 },
    );

    const { data: targetParams } = useGetList<ParameterRecord>(
        'site_parameters',
        {
            filter: { site_id: targetSiteId },
            pagination: { page: 1, perPage: 100 },
            sort: { field: 'name', order: 'ASC' },
        },
        { enabled: step === 2 && !!targetSiteId },
    );

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
                    site_id: targetSiteId,
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

    const activeStep = step === 1 ? 0 : step === 2 ? 1 : 2;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
                            slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                            label="Notes"
                            value={movNotes}
                            onChange={(e) => setMovNotes(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
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
                            slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                            label="Notes"
                            value={newDeployNotes}
                            onChange={(e) => setNewDeployNotes(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
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
                        <Button onClick={onClose} disabled={updatePending}>
                            Cancel
                        </Button>
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
                        <Button onClick={onClose}>Skip — I'll do this later</Button>
                        <Button
                            onClick={handleCreateDeployment}
                            variant="contained"
                            disabled={createPending || !targetSiteId || !newDeployedFrom}
                            startIcon={createPending ? <CircularProgress size={16} /> : undefined}
                        >
                            Create Deployment
                        </Button>
                    </>
                )}
                {step === 'done' && (
                    <Button onClick={onClose} variant="contained">
                        Close
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
