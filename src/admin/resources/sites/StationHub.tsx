import React, { useState, useMemo } from 'react';
import {
    useGetOne,
    useGetList,
    useCreate,
    useUpdate,
    useDelete,
    useNotify,
    useRefresh,
    Title,
    Loading,
} from 'react-admin';
import {
    Box,
    Typography,
    Grid2 as Grid,
    Alert,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    MenuItem,
    CircularProgress,
    Card,
    CardContent,
    Collapse,
    IconButton,
    Chip,
    Checkbox,
    FormControlLabel,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import AddIcon from '@mui/icons-material/Add';
import SensorsIcon from '@mui/icons-material/Sensors';
import FunctionsIcon from '@mui/icons-material/Functions';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import VerifiedIcon from '@mui/icons-material/Verified';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import InsightsIcon from '@mui/icons-material/Insights';
import { useParams } from 'react-router-dom';
import { StationHeader } from './StationHeader';
import { SensorCard } from './SensorCard';
import { DerivedSection } from './DerivedSection';
import { ParameterChart } from './ParameterChart';
import { DataExportDialog } from './DataExportDialog';
import { ScatterPlot } from '../../components/charts/ScatterPlot';
import { StatusEventsTimeline } from './StatusEventsTimeline';
import { AssignToSiteDialog } from '../derived_parameters/AssignToSiteDialog';
import { useLatestReadings, useSensorGroups } from './hooks';
import type {
    ParameterRecord,
    SensorDeploymentRecord,
    SensorRecord,
    AlarmThresholdRecord,
} from './SensorCard';
import type { DerivedParameterRecord } from './DerivedSection';

// ---------------------------------------------------------------------------
// Add Parameter Dialog
// ---------------------------------------------------------------------------

interface GlobalParameterType {
    id: string;
    name: string;
    display_name: string;
    default_units: string;
}

const AddParameterDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    siteId: string;
}> = ({ open, onClose, siteId }) => {
    const [create, { isPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [paramTypeId, setParamTypeId] = useState('');
    const [displayUnits, setDisplayUnits] = useState('');
    const [sensorType, setSensorType] = useState('');
    const [sampleInterval, setSampleInterval] = useState('600');

    const { data: paramTypes } = useGetList<GlobalParameterType>('parameters', {
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    });

    const selectedType = paramTypes?.find((pt) => pt.id === paramTypeId);

    const handleSubmit = () => {
        create(
            'site_parameters',
            {
                data: {
                    site_id: siteId,
                    parameter_type_id: paramTypeId,
                    name: selectedType?.display_name ?? selectedType?.name ?? '',
                    sensor_type: sensorType || null,
                    display_units: displayUnits || selectedType?.default_units || null,
                    is_active: true,
                    is_derived: false,
                    sample_interval_sec: parseInt(sampleInterval) || 600,
                },
            },
            {
                onSuccess: () => {
                    notify('Parameter added', { type: 'success' });
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
        setParamTypeId('');
        setDisplayUnits('');
        setSensorType('');
        setSampleInterval('600');
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Add Parameter</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                    select
                    label="Parameter Type"
                    value={paramTypeId}
                    onChange={(e) => {
                        setParamTypeId(e.target.value);
                        const pt = paramTypes?.find((p) => p.id === e.target.value);
                        if (pt) setDisplayUnits(pt.default_units);
                    }}
                    fullWidth
                    size="small"
                >
                    {(paramTypes ?? []).map((pt) => (
                        <MenuItem key={pt.id} value={pt.id}>
                            {pt.display_name || pt.name} ({pt.default_units})
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label="Display Units"
                    value={displayUnits}
                    onChange={(e) => setDisplayUnits(e.target.value)}
                    fullWidth
                    size="small"
                />
                <TextField
                    label="Sensor Type"
                    value={sensorType}
                    onChange={(e) => setSensorType(e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="e.g. optical, electrochemical"
                />
                <TextField
                    label="Sample Interval (seconds)"
                    type="number"
                    value={sampleInterval}
                    onChange={(e) => setSampleInterval(e.target.value)}
                    fullWidth
                    size="small"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending || !paramTypeId}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    Add Parameter
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Deploy Sensor Dialog
// ---------------------------------------------------------------------------

const DeploySensorDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    parameters: ParameterRecord[];
}> = ({ open, onClose, parameters }) => {
    const [create, { isPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [sensorId, setSensorId] = useState('');
    const [parameterId, setParameterId] = useState('');
    const [deployedFrom, setDeployedFrom] = useState(new Date().toISOString().slice(0, 16));
    const [notes, setNotes] = useState('');

    const { data: allSensors } = useGetList<SensorRecord>('sensors', {
        filter: { is_active: true },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'serial_number', order: 'ASC' },
    });

    const handleSubmit = () => {
        create(
            'sensor_deployments',
            {
                data: {
                    sensor_id: sensorId,
                    parameter_id: parameterId,
                    deployed_from: new Date(deployedFrom).toISOString(),
                    deployed_until: null,
                    deployment_type: 'manual',
                    notes: notes || null,
                },
            },
            {
                onSuccess: () => {
                    notify('Sensor deployed', { type: 'success' });
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
        setSensorId('');
        setParameterId('');
        setDeployedFrom(new Date().toISOString().slice(0, 16));
        setNotes('');
        onClose();
    };

    const nonDerivedParams = parameters.filter((p) => !p.is_derived);

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Deploy Sensor</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                    select
                    label="Sensor"
                    value={sensorId}
                    onChange={(e) => setSensorId(e.target.value)}
                    fullWidth
                    size="small"
                >
                    {(allSensors ?? []).map((s) => (
                        <MenuItem key={s.id} value={s.id}>
                            {s.serial_number} {s.manufacturer ? `(${s.manufacturer} ${s.model ?? ''})`.trim() : ''}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    select
                    label="Target Parameter"
                    value={parameterId}
                    onChange={(e) => setParameterId(e.target.value)}
                    fullWidth
                    size="small"
                >
                    {nonDerivedParams.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.name} ({p.display_units ?? 'N/A'})
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label="Deployed From"
                    type="datetime-local"
                    value={deployedFrom}
                    onChange={(e) => setDeployedFrom(e.target.value)}
                    fullWidth
                    size="small"
                    slotProps={{ inputLabel: { shrink: true } }}
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
                <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending || !sensorId || !parameterId}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    Deploy
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// Assign Derived Formula Button (for StationHub)
// ---------------------------------------------------------------------------

const AssignDerivedButton: React.FC<{ siteId: string }> = ({ siteId }) => {
    const [open, setOpen] = useState(false);
    const [selectedDefId, setSelectedDefId] = useState('');

    const { data: allDefs } = useGetList<DerivedParameterRecord>('derived_parameters', {
        pagination: { page: 1, perPage: 100 },
        sort: { field: 'name', order: 'ASC' },
    });

    const selectedDef = allDefs?.find((d) => d.id === selectedDefId);

    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<FunctionsIcon />}
                onClick={() => setOpen(true)}
            >
                Assign Derived Formula
            </Button>
            <Dialog open={open && !selectedDef} onClose={() => { setOpen(false); setSelectedDefId(''); }} maxWidth="sm" fullWidth>
                <DialogTitle>Select Derived Formula</DialogTitle>
                <DialogContent>
                    <TextField
                        select
                        label="Derived Formula"
                        value={selectedDefId}
                        onChange={(e) => setSelectedDefId(e.target.value)}
                        fullWidth
                        size="small"
                        sx={{ mt: 1 }}
                    >
                        {(allDefs ?? []).map((d) => (
                            <MenuItem key={d.id} value={d.id}>
                                {d.display_name ?? d.name} — {d.formula}
                            </MenuItem>
                        ))}
                    </TextField>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => { setOpen(false); setSelectedDefId(''); }}>Cancel</Button>
                </DialogActions>
            </Dialog>
            {selectedDef && (
                <AssignToSiteDialog
                    open={open}
                    onClose={() => { setOpen(false); setSelectedDefId(''); }}
                    definition={{
                        id: selectedDef.id,
                        name: selectedDef.name,
                        display_name: selectedDef.display_name,
                        formula: selectedDef.formula,
                        units: selectedDef.units,
                        sources: selectedDef.sources ?? [],
                    }}
                    preselectedSiteId={siteId}
                />
            )}
        </>
    );
};

// ---------------------------------------------------------------------------
// Notes Section
// ---------------------------------------------------------------------------

interface NoteRecord {
    id: string;
    site_id: string;
    text: string;
    verified: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}

const AddNoteDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    siteId: string;
}> = ({ open, onClose, siteId }) => {
    const [create, { isPending }] = useCreate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [text, setText] = useState('');
    const [verified, setVerified] = useState(false);

    const handleSubmit = () => {
        create(
            'notes',
            {
                data: {
                    site_id: siteId,
                    text,
                    verified,
                },
            },
            {
                onSuccess: () => {
                    notify('Note added', { type: 'success' });
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
        setText('');
        setVerified(false);
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Add Note</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                    label="Note"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    multiline
                    rows={4}
                    fullWidth
                    size="small"
                    required
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={verified}
                            onChange={(e) => setVerified(e.target.checked)}
                        />
                    }
                    label="Verified"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending || !text.trim()}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    Add Note
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const EditNoteDialog: React.FC<{
    open: boolean;
    onClose: () => void;
    note: NoteRecord | null;
}> = ({ open, onClose, note }) => {
    const [update, { isPending }] = useUpdate();
    const notify = useNotify();
    const refresh = useRefresh();

    const [text, setText] = useState('');
    const [verified, setVerified] = useState(false);

    React.useEffect(() => {
        if (note) {
            setText(note.text);
            setVerified(note.verified);
        }
    }, [note]);

    const handleSubmit = () => {
        if (!note) return;
        update(
            'notes',
            { id: note.id, data: { text, verified }, previousData: note },
            {
                onSuccess: () => {
                    notify('Note updated', { type: 'success' });
                    refresh();
                    onClose();
                },
                onError: (error) => {
                    notify(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { type: 'error' });
                },
            },
        );
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Edit Note</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                <TextField
                    label="Note"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    multiline
                    rows={4}
                    fullWidth
                    size="small"
                    required
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={verified}
                            onChange={(e) => setVerified(e.target.checked)}
                        />
                    }
                    label="Verified"
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={isPending}>Cancel</Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={isPending || !text.trim()}
                    startIcon={isPending ? <CircularProgress size={16} /> : undefined}
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const NotesSection: React.FC<{ siteId: string }> = ({ siteId }) => {
    const [expanded, setExpanded] = useState(false);
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [editingNote, setEditingNote] = useState<NoteRecord | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<NoteRecord | null>(null);
    const [deleteOne] = useDelete();
    const notify = useNotify();
    const refresh = useRefresh();

    const { data: notes, isPending } = useGetList<NoteRecord>('notes', {
        filter: { site_id: siteId },
        pagination: { page: 1, perPage: 50 },
        sort: { field: 'created_at', order: 'DESC' },
    }, { enabled: !!siteId });

    return (
        <Box sx={{ mt: 3 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                    cursor: 'pointer',
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Typography variant="h6">
                    Notes {notes && notes.length > 0 ? `(${notes.length})` : ''}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {expanded && (
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<NoteAddIcon />}
                            onClick={(e) => {
                                e.stopPropagation();
                                setAddNoteOpen(true);
                            }}
                        >
                            Add Note
                        </Button>
                    )}
                    <IconButton size="small">
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                </Box>
            </Box>

            <Collapse in={expanded}>
                <Card variant="outlined">
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        {isPending && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                                <CircularProgress size={24} />
                            </Box>
                        )}

                        {!isPending && (!notes || notes.length === 0) && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ textAlign: 'center' }}
                            >
                                No notes yet.
                            </Typography>
                        )}

                        {!isPending && notes && notes.length > 0 && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                {notes.map((note) => (
                                    <Box
                                        key={note.id}
                                        sx={{
                                            p: 1.5,
                                            borderRadius: 1,
                                            bgcolor: 'action.hover',
                                        }}
                                    >
                                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}>
                                            {note.text}
                                        </Typography>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {note.verified && (
                                                <Chip
                                                    icon={<VerifiedIcon />}
                                                    label="Verified"
                                                    size="small"
                                                    color="success"
                                                    variant="outlined"
                                                />
                                            )}
                                            {note.created_by && (
                                                <Typography variant="caption" color="text.secondary">
                                                    {note.created_by}
                                                </Typography>
                                            )}
                                            <Typography variant="caption" color="text.secondary">
                                                {relativeTime(note.created_at)}
                                            </Typography>
                                            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => setEditingNote(note)}
                                                    title="Edit note"
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => setDeleteTarget(note)}
                                                    title="Delete note"
                                                    color="error"
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                        </Box>
                                    </Box>
                                ))}
                            </Box>
                        )}
                    </CardContent>
                </Card>
            </Collapse>

            <AddNoteDialog
                open={addNoteOpen}
                onClose={() => setAddNoteOpen(false)}
                siteId={siteId}
            />
            <EditNoteDialog
                open={editingNote !== null}
                onClose={() => setEditingNote(null)}
                note={editingNote}
            />
            <Dialog
                open={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>Delete Note</DialogTitle>
                <DialogContent>
                    <Typography>Are you sure you want to delete this note?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
                    <Button
                        color="error"
                        variant="contained"
                        onClick={() => {
                            if (!deleteTarget) return;
                            deleteOne(
                                'notes',
                                { id: deleteTarget.id, previousData: deleteTarget },
                                {
                                    onSuccess: () => {
                                        notify('Note deleted', { type: 'success' });
                                        refresh();
                                        setDeleteTarget(null);
                                    },
                                    onError: (error) => {
                                        notify(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { type: 'error' });
                                    },
                                },
                            );
                        }}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

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
    const [addParamOpen, setAddParamOpen] = useState(false);
    const [deploySensorOpen, setDeploySensorOpen] = useState(false);
    const [analysisExpanded, setAnalysisExpanded] = useState(false);

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
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">
                    Deployed Sensors
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => setAddParamOpen(true)}
                    >
                        Add Parameter
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<SensorsIcon />}
                        onClick={() => setDeploySensorOpen(true)}
                        disabled={!(parameters ?? []).some((p) => !p.is_derived)}
                    >
                        Deploy Sensor
                    </Button>
                </Box>
            </Box>

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

            {/* Analysis (Scatter Plot) */}
            {(parameters ?? []).filter((p) => !p.is_derived).length >= 2 && (
                <Box sx={{ mt: 3 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            mb: 1,
                            cursor: 'pointer',
                        }}
                        onClick={() => setAnalysisExpanded(!analysisExpanded)}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <InsightsIcon color="action" />
                            <Typography variant="h6">Analysis</Typography>
                        </Box>
                        <IconButton size="small">
                            {analysisExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                    </Box>
                    <Collapse in={analysisExpanded}>
                        <ScatterPlot
                            siteId={id!}
                            parameters={(parameters ?? []).map((p) => ({
                                id: p.id,
                                name: p.name,
                                units: p.display_units,
                            }))}
                        />
                    </Collapse>
                </Box>
            )}

            {/* Device Status Events */}
            <StatusEventsTimeline
                siteId={id!}
                parameterNames={parameterNames}
            />

            {/* Station Notes */}
            <NotesSection siteId={id!} />

            {/* Derived Parameters */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 3, mb: 1 }}>
                <Box />
                <AssignDerivedButton siteId={id!} />
            </Box>
            <DerivedSection
                derivedParams={derivedParams}
                derivedDefs={derivedDefById}
                allSiteParams={parameters ?? []}
                latestByParam={latestByParam}
                deployments={deployments ?? []}
            />

            {/* Dialogs */}
            <DataExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                siteId={id!}
                siteName={site.name}
                parameters={(parameters ?? []).map((p) => ({ id: p.id, name: p.name, is_derived: p.is_derived }))}
            />
            <AddParameterDialog
                open={addParamOpen}
                onClose={() => setAddParamOpen(false)}
                siteId={id!}
            />
            <DeploySensorDialog
                open={deploySensorOpen}
                onClose={() => setDeploySensorOpen(false)}
                parameters={parameters ?? []}
            />
        </Box>
    );
};

export default StationHub;
