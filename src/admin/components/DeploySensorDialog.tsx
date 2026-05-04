import React, { useState, useMemo, useEffect } from 'react';
import {
    useGetList,
    useGetOne,
    useCreate,
    useNotify,
    useRefresh,
} from 'react-admin';
import {
    Autocomplete,
    Alert,
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    MenuItem,
    TextField,
    Typography,
} from '@mui/material';
import type { SensorRecord, ParameterRecord } from '../resources/sites/SensorCard';

interface SiteRecord {
    id: string;
    name: string;
    project_id: string;
}

interface ProjectRecord {
    id: string;
    name: string;
}

interface DeploySensorDialogProps {
    open: boolean;
    onClose: () => void;
    sensorId?: string;
    siteId?: string;
}

const sensorLabel = (s: SensorRecord) =>
    s.serial_number ?? s.name ?? 'Unnamed';

const getActiveDeploy = (s: SensorRecord) =>
    s.deployments?.find((d) => d.deployed_until === null);

export const DeploySensorDialog: React.FC<DeploySensorDialogProps> = ({
    open,
    onClose,
    sensorId: prefillSensorId,
    siteId: prefillSiteId,
}) => {
    const [create, { isPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [selectedSensor, setSelectedSensor] = useState<SensorRecord | null>(null);
    const [selectedSiteId, setSelectedSiteId] = useState(prefillSiteId ?? '');
    const [parameterId, setParameterId] = useState('');
    const [deployedFrom, setDeployedFrom] = useState(new Date().toISOString().slice(0, 16));
    const [notes, setNotes] = useState('');

    // Data fetches
    const { data: allSensors } = useGetList<SensorRecord>('sensors', {
        filter: { is_active: true },
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'serial_number', order: 'ASC' },
    });

    const { data: allSites } = useGetList<SiteRecord>('sites', {
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    });

    const { data: projects } = useGetList<ProjectRecord>('projects', {
        pagination: { page: 1, perPage: 50 },
        sort: { field: 'name', order: 'ASC' },
    });

    const { data: siteParams } = useGetList<ParameterRecord>('site_parameters', {
        filter: selectedSiteId ? { site_id: selectedSiteId, is_active: true } : {},
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: !!selectedSiteId });

    const { data: prefillSensorData } = useGetOne<SensorRecord>('sensors', {
        id: prefillSensorId ?? '',
    }, { enabled: !!prefillSensorId && !selectedSensor });

    // Pre-fill sensor from prop
    useEffect(() => {
        if (prefillSensorData && !selectedSensor) {
            setSelectedSensor(prefillSensorData);
        }
    }, [prefillSensorData, selectedSensor]);

    // Pre-fill site from prop
    useEffect(() => {
        if (prefillSiteId && !selectedSiteId) {
            setSelectedSiteId(prefillSiteId);
        }
    }, [prefillSiteId]);

    // Lookups
    const siteMap = useMemo(
        () => new Map((allSites ?? []).map((s) => [s.id, s.name])),
        [allSites],
    );

    const projectMap = useMemo(
        () => new Map((projects ?? []).map((p) => [p.id, p.name])),
        [projects],
    );

    const sortedSensors = useMemo(() => {
        if (!allSensors) return [];
        return [...allSensors].sort((a, b) => {
            const aDeployed = !!getActiveDeploy(a);
            const bDeployed = !!getActiveDeploy(b);
            if (aDeployed !== bDeployed) return aDeployed ? 1 : -1;
            return (a.serial_number ?? a.name ?? '').localeCompare(b.serial_number ?? b.name ?? '');
        });
    }, [allSensors]);

    const nonDerivedParams = useMemo(
        () => (siteParams ?? []).filter((p) => !p.is_derived),
        [siteParams],
    );

    // Auto-select parameter when sensor determines compatibility
    useEffect(() => {
        if (!selectedSensor || !nonDerivedParams.length) return;
        const match = nonDerivedParams.find((p) => p.parameter_id === selectedSensor.parameter_id);
        if (match && !parameterId) {
            setParameterId(match.id);
        }
    }, [selectedSensor, nonDerivedParams]);

    const activeDeploy = selectedSensor ? getActiveDeploy(selectedSensor) : null;
    const isMoving = activeDeploy && activeDeploy.site_id !== selectedSiteId;
    const selectedSite = allSites?.find((s) => s.id === selectedSiteId) ?? null;

    const handleSubmit = () => {
        if (!selectedSensor || !selectedSiteId) return;
        create(
            'sensor_deployments',
            {
                data: {
                    sensor_id: selectedSensor.id,
                    site_id: selectedSiteId,
                    deployed_from: new Date(deployedFrom).toISOString(),
                    deployed_until: null,
                    deployment_type: 'manual',
                    notes: notes || null,
                },
            },
            {
                onSuccess: () => {
                    notify(isMoving ? 'Sensor moved' : 'Sensor deployed', { type: 'success' });
                    refresh();
                    handleClose();
                },
                onError: (error) => {
                    notify(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { type: 'error' });
                },
            },
        );
    };

    const handleClose = () => {
        setSelectedSensor(null);
        setSelectedSiteId(prefillSiteId ?? '');
        setParameterId('');
        setDeployedFrom(new Date().toISOString().slice(0, 16));
        setNotes('');
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>{isMoving ? 'Move Sensor' : 'Deploy Sensor'}</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                {/* Sensor Autocomplete */}
                <Autocomplete
                    options={sortedSensors}
                    value={selectedSensor}
                    onChange={(_, v) => {
                        setSelectedSensor(v);
                        setParameterId('');
                    }}
                    getOptionLabel={sensorLabel}
                    groupBy={(s) => getActiveDeploy(s) ? 'Currently Deployed' : 'Available'}
                    isOptionEqualToValue={(opt, val) => opt.id === val.id}
                    disabled={!!prefillSensorId}
                    renderOption={(props, s) => {
                        const dep = getActiveDeploy(s);
                        const depSiteName = dep ? siteMap.get(dep.site_id) ?? dep.site_id.slice(0, 8) : null;
                        return (
                            <li {...props} key={s.id}>
                                <Box sx={{ width: '100%' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2">
                                            {sensorLabel(s)}
                                        </Typography>
                                        {dep && (
                                            <Chip
                                                label={dep.site_id === selectedSiteId ? 'This site' : depSiteName}
                                                color={dep.site_id === selectedSiteId ? 'primary' : 'default'}
                                                variant="outlined"
                                            />
                                        )}
                                    </Box>
                                    {(s.manufacturer || dep) && (
                                        <Typography variant="caption" color="text.secondary">
                                            {[
                                                s.manufacturer ? `${s.manufacturer}${s.model ? ` ${s.model}` : ''}` : null,
                                                dep ? `Since ${new Date(dep.deployed_from).toLocaleDateString()}` : null,
                                            ].filter(Boolean).join(' · ')}
                                        </Typography>
                                    )}
                                </Box>
                            </li>
                        );
                    }}
                    renderInput={(params) => <TextField {...params} label="Sensor" />}
                />

                {/* Auto-recall warning */}
                {isMoving && (() => {
                    const name = siteMap.get(activeDeploy!.site_id) ?? activeDeploy!.site_id.slice(0, 8);
                    return (
                        <Alert severity="warning">
                            This sensor is currently deployed at <strong>{name}</strong>. Deploying here will automatically recall it.
                        </Alert>
                    );
                })()}

                {/* Target Site Autocomplete */}
                <Autocomplete
                    options={allSites ?? []}
                    value={selectedSite}
                    onChange={(_, v) => {
                        setSelectedSiteId(v?.id ?? '');
                        setParameterId('');
                    }}
                    getOptionLabel={(s) => s.name}
                    groupBy={(s) => projectMap.get(s.project_id) ?? 'Unknown Project'}
                    isOptionEqualToValue={(opt, val) => opt.id === val.id}
                    disabled={!!prefillSiteId}
                    renderInput={(params) => <TextField {...params} label="Target Site" />}
                />

                {/* Target Parameter */}
                <TextField
                    select
                    label="Target Parameter"
                    value={parameterId}
                    onChange={(e) => setParameterId(e.target.value)}
                    fullWidth
                    disabled={!selectedSiteId}
                    helperText={!selectedSiteId ? 'Select a site first' : undefined}
                >
                    {nonDerivedParams.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.parameter?.[0]?.display_name || p.name} ({p.display_units ?? 'N/A'})
                        </MenuItem>
                    ))}
                </TextField>

                <TextField
                    label="Deployed From"
                    type="datetime-local"
                    value={deployedFrom}
                    onChange={(e) => setDeployedFrom(e.target.value)}
                    fullWidth
                    slotProps={{ inputLabel: { shrink: true } }}
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
                <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending || !selectedSensor || !selectedSiteId || !parameterId}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    {isMoving ? 'Move' : 'Deploy'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
