import React, { useState, useMemo, useCallback } from 'react';
import {
    useGetList,
    useNotify,
    Title,
} from 'react-admin';
import {
    Box,
    Typography,
    Button,
    TextField,
    MenuItem,
    IconButton,
    Paper,
    Divider,
    Stepper,
    Step,
    StepLabel,
    Alert,
    CircularProgress,
    Snackbar,
    Chip,
    Collapse,
    List,
    ListItem,
    ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import HikingIcon from '@mui/icons-material/Hiking';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useAuthFetch } from '../../hooks/useAuthFetch';

interface ProjectRecord {
    id: string;
    name: string;
}

interface SiteRecord {
    id: string;
    name: string;
    project_id: string | null;
}

interface NestedParameter {
    id: string;
    name: string;
    display_name: string;
}

interface SiteParameterRecord {
    id: string;
    site_id: string;
    parameter_id: string;
    name: string;
    display_units: string | null;
    is_active: boolean | null;
    is_derived: boolean | null;
    parameter: NestedParameter[];
}

interface SensorRecord {
    id: string;
    serial_number: string | null;
    name: string | null;
    manufacturer: string | null;
    is_active: boolean | null;
    is_lab_instrument: boolean | null;
}

interface ReadingRow {
    id: number;
    parameter_id: string;
    sensor_id: string;
    value: string;
}

interface StationEntry {
    site_id: string;
    dateTime: string;
    rows: ReadingRow[];
}

const STEPS = ['Trip Details', 'Site Samples', 'Review & Submit'];

const toLocalDate = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const toLocalDatetime = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const FieldTripPage: React.FC = () => {
    const notify = useNotify();
    const authFetch = useAuthFetch();

    const [activeStep, setActiveStep] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [successInfo, setSuccessInfo] = useState<{ count: number; tripId: string } | null>(null);

    // Step 1: Trip metadata
    const [projectFilter, setProjectFilter] = useState('');
    const [tripDate, setTripDate] = useState(() => toLocalDate(new Date()));
    const [participants, setParticipants] = useState('');
    const [tripNotes, setTripNotes] = useState('');

    // Step 2: Station samples
    const [stations, setStations] = useState<StationEntry[]>([
        { site_id: '', dateTime: toLocalDatetime(new Date()), rows: [{ id: 1, parameter_id: '', sensor_id: '', value: '' }] },
    ]);
    const [nextRowId, setNextRowId] = useState(2);

    // Replicate state keyed by "stationIndex:rowId"
    const [replicateInputs, setReplicateInputs] = useState<Record<string, string[]>>({});
    const [showReplicates, setShowReplicates] = useState<Set<string>>(new Set());

    const repKey = (si: number, rowId: number) => `${si}:${rowId}`;

    const MAX_REPLICATES = 10;

    const sampleStdDev = (values: number[]): number => {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
    };

    const getRepStats = useCallback((si: number, row: ReadingRow) => {
        const reps = replicateInputs[repKey(si, row.id)];
        if (!reps || reps.length === 0) return null;
        const allValues = [row.value, ...reps].map(v => parseFloat(v)).filter(v => !isNaN(v));
        if (allValues.length < 2) return null;
        const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        return { mean, sd: sampleStdDev(allValues), count: allValues.length };
    }, [replicateInputs]);

    // Data fetching
    const { data: projects } = useGetList<ProjectRecord>('projects', {
        pagination: { page: 1, perPage: 50 },
        sort: { field: 'name', order: 'ASC' },
    });

    const siteFilter = useMemo(
        () => projectFilter ? { project_id: projectFilter } : {},
        [projectFilter],
    );
    const { data: sites } = useGetList<SiteRecord>('sites', {
        filter: siteFilter,
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    });

    // Fetch params for all selected sites
    const selectedSiteIds = stations.map((s) => s.site_id).filter(Boolean);
    const { data: allSiteParameters } = useGetList<SiteParameterRecord>('site_parameters', {
        filter: { is_active: true },
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: selectedSiteIds.length > 0 });

    const { data: sensors } = useGetList<SensorRecord>('sensors', {
        filter: { is_lab_instrument: true, is_active: true },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'serial_number', order: 'ASC' },
    });

    const paramsBySite = useMemo(() => {
        const map = new Map<string, SiteParameterRecord[]>();
        (allSiteParameters ?? [])
            .filter((p) => !p.is_derived)
            .forEach((p) => {
                const existing = map.get(p.site_id) ?? [];
                existing.push(p);
                map.set(p.site_id, existing);
            });
        return map;
    }, [allSiteParameters]);

    // Station management
    const addStation = () => {
        setStations((prev) => [
            ...prev,
            { site_id: '', dateTime: toLocalDatetime(new Date()), rows: [{ id: nextRowId, parameter_id: '', sensor_id: '', value: '' }] },
        ]);
        setNextRowId((n) => n + 1);
    };

    const removeStation = (index: number) => {
        setStations((prev) => prev.filter((_, i) => i !== index));
    };

    const updateStation = (index: number, field: keyof StationEntry, value: string) => {
        setStations((prev) =>
            prev.map((s, i) => {
                if (i !== index) return s;
                if (field === 'site_id') {
                    // Reset rows when station changes
                    return { ...s, site_id: value, rows: [{ id: nextRowId, parameter_id: '', sensor_id: '', value: '' }] };
                }
                return { ...s, [field]: value };
            }),
        );
        if (field === 'site_id') setNextRowId((n) => n + 1);
    };

    const addRow = (stationIndex: number) => {
        setStations((prev) =>
            prev.map((s, i) =>
                i === stationIndex
                    ? { ...s, rows: [...s.rows, { id: nextRowId, parameter_id: '', sensor_id: '', value: '' }] }
                    : s,
            ),
        );
        setNextRowId((n) => n + 1);
    };

    const removeRow = (stationIndex: number, rowId: number) => {
        setStations((prev) =>
            prev.map((s, i) =>
                i === stationIndex
                    ? { ...s, rows: s.rows.filter((r) => r.id !== rowId) }
                    : s,
            ),
        );
    };

    const updateRow = (stationIndex: number, rowId: number, field: keyof ReadingRow, value: string) => {
        setStations((prev) =>
            prev.map((s, i) =>
                i === stationIndex
                    ? { ...s, rows: s.rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)) }
                    : s,
            ),
        );
    };

    // Validation
    const validateStep1 = (): string | null => {
        if (!tripDate) return 'Please set a trip date';
        return null;
    };

    const validateStep2 = (): string | null => {
        const validStations = stations.filter((s) => s.site_id);
        if (validStations.length === 0) return 'Add at least one site with samples';

        for (let si = 0; si < validStations.length; si++) {
            const station = validStations[si];
            if (!station.dateTime) return 'Each site needs a date/time';
            const validRows = station.rows.filter((r) => r.parameter_id || r.value);
            if (validRows.length === 0) {
                const name = sites?.find((s) => s.id === station.site_id)?.name ?? 'site';
                return `Add at least one reading for ${name}`;
            }
            for (const row of validRows) {
                if (!row.parameter_id) return 'Each row needs a parameter';
                const stats = getRepStats(si, row);
                if (stats) continue;
                if (!row.value || isNaN(parseFloat(row.value))) return 'Each row needs a valid numeric value';
            }
            const paramIds = validRows.map((r) => r.parameter_id);
            if (new Set(paramIds).size !== paramIds.length) {
                const name = sites?.find((s) => s.id === station.site_id)?.name ?? 'site';
                return `Duplicate parameters in ${name} — use replicates within a row for repeated measurements`;
            }
        }
        return null;
    };

    const handleNext = () => {
        if (activeStep === 0) {
            const err = validateStep1();
            if (err) { notify(err, { type: 'warning' }); return; }
        }
        if (activeStep === 1) {
            const err = validateStep2();
            if (err) { notify(err, { type: 'warning' }); return; }
        }
        setActiveStep((prev) => prev + 1);
    };

    const handleBack = () => setActiveStep((prev) => prev - 1);

    // Build summary data for review step
    const summaryData = useMemo(() => {
        return stations
            .filter((s) => s.site_id)
            .map((s) => {
                const siteName = sites?.find((site) => site.id === s.site_id)?.name ?? s.site_id;
                const params = paramsBySite.get(s.site_id) ?? [];
                const validRows = s.rows.filter((r) => r.parameter_id && r.value);
                return {
                    siteName,
                    dateTime: s.dateTime,
                    readings: validRows.map((r) => {
                        const param = params.find((p) => p.parameter_id === r.parameter_id);
                        const dn = param?.parameter?.[0]?.display_name;
                        return {
                            paramName: dn ? `${dn} (${param?.name})` : (param?.name ?? r.parameter_id),
                            units: param?.display_units ?? '',
                            value: r.value,
                        };
                    }),
                };
            });
    }, [stations, sites, paramsBySite]);

    const totalReadings = summaryData.reduce((sum, s) => sum + s.readings.length, 0);

    const handleSubmit = async () => {
        setSubmitting(true);
        try {
            const payload = {
                date: tripDate,
                participants: participants || null,
                notes: tripNotes || null,
                stations: stations
                    .filter((s) => s.site_id)
                    .map((s, si) => ({
                        site_id: s.site_id,
                        readings: s.rows
                            .filter((r) => r.parameter_id && (r.value || getRepStats(si, r)))
                            .flatMap((r) => {
                                const rk = repKey(si, r.id);
                                const reps = replicateInputs[rk];
                                const timestamp = new Date(s.dateTime).toISOString();
                                const hasReplicates = reps && reps.length > 0;

                                if (hasReplicates) {
                                    return [r.value, ...reps]
                                        .map(v => parseFloat(v))
                                        .filter(v => !isNaN(v))
                                        .map(value => ({
                                            parameter_id: r.parameter_id,
                                            sensor_id: r.sensor_id || null,
                                            value,
                                            time: timestamp,
                                        }));
                                }
                                return [{
                                    parameter_id: r.parameter_id,
                                    sensor_id: r.sensor_id || null,
                                    value: parseFloat(r.value),
                                    time: timestamp,
                                }];
                            }),
                    })),
            };

            const response = await authFetch('/api/service/actions/field_trip_batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(err.error || 'Failed to submit');
            }

            const result = await response.json();
            setSuccessInfo({ count: result.total_inserted, tripId: result.field_trip_id });

            // Reset form
            setActiveStep(0);
            setTripDate(toLocalDate(new Date()));
            setParticipants('');
            setTripNotes('');
            setStations([{ site_id: '', dateTime: toLocalDatetime(new Date()), rows: [{ id: nextRowId, parameter_id: '', sensor_id: '', value: '' }] }]);
            setNextRowId((n) => n + 1);
            setReplicateInputs({});
            setShowReplicates(new Set());
        } catch (e) {
            notify(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}`, { type: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Box sx={{ p: 2, maxWidth: 1000, mx: 'auto' }}>
            <Title title="Field Trip Entry" />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <HikingIcon color="primary" />
                <Typography variant="h5">Field Trip Entry</Typography>
            </Box>

            <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
                {STEPS.map((label) => (
                    <Step key={label}>
                        <StepLabel>{label}</StepLabel>
                    </Step>
                ))}
            </Stepper>

            {/* Step 1: Trip Details */}
            {activeStep === 0 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Trip Details</Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <TextField
                            select
                            label="Project"
                            value={projectFilter}
                            onChange={(e) => {
                                setProjectFilter(e.target.value);
                                setStations(prev => prev.map(s => ({ ...s, site_id: '', rows: [{ id: nextRowId, parameter_id: '', sensor_id: '', value: '' }] })));
                                setNextRowId(n => n + 1);
                            }}
                            sx={{ minWidth: 200 }}
                        >
                            <MenuItem value=""><em>All projects</em></MenuItem>
                            {(projects ?? []).map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                            ))}
                        </TextField>
                        <TextField
                            label="Trip Date"
                            type="date"
                            value={tripDate}
                            onChange={(e) => setTripDate(e.target.value)}
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ minWidth: 180 }}
                        />
                        <TextField
                            label="Participants"
                            value={participants}
                            onChange={(e) => setParticipants(e.target.value)}
                            placeholder="e.g. Alice, Bob"
                            sx={{ minWidth: 300, flex: 1 }}
                        />
                    </Box>
                    <TextField
                        label="Trip Notes"
                        value={tripNotes}
                        onChange={(e) => setTripNotes(e.target.value)}
                        multiline
                        rows={3}
                        fullWidth
                        sx={{ mt: 2 }}
                        placeholder="Weather conditions, observations, etc."
                    />
                </Paper>
            )}

            {/* Step 2: Station Samples */}
            {activeStep === 1 && (
                <Box>
                    {stations.map((station, si) => {
                        const stationParams = paramsBySite.get(station.site_id) ?? [];
                        return (
                            <Paper key={si} sx={{ p: 3, mb: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                    <Typography variant="h6">
                                        Site {si + 1}
                                        {station.site_id && sites && (
                                            <Chip
                                                label={sites.find((s) => s.id === station.site_id)?.name}
                                                sx={{ ml: 1 }}
                                            />
                                        )}
                                    </Typography>
                                    {stations.length > 1 && (
                                        <IconButton onClick={() => removeStation(si)} color="error">
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>

                                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                                    <TextField
                                        select
                                        label="Site"
                                        value={station.site_id}
                                        onChange={(e) => updateStation(si, 'site_id', e.target.value)}
                                        sx={{ minWidth: 250 }}
                                        disabled={!sites?.length}
                                    >
                                        {(sites ?? []).map((s) => (
                                            <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                                        ))}
                                    </TextField>

                                    <TextField
                                        label="Sample Time (local)"
                                        type="datetime-local"
                                        value={station.dateTime}
                                        onChange={(e) => updateStation(si, 'dateTime', e.target.value)}
                                        slotProps={{ inputLabel: { shrink: true } }}
                                        sx={{ minWidth: 220 }}
                                    />
                                </Box>

                                {station.site_id && (
                                    <>
                                        <Divider sx={{ mb: 1.5 }} />
                                        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                                            <Typography variant="body2" sx={{ flex: 3, fontWeight: 600 }}>Parameter</Typography>
                                            <Typography variant="body2" sx={{ flex: 2, fontWeight: 600 }}>Instrument</Typography>
                                            <Typography variant="body2" sx={{ flex: 1.5, fontWeight: 600 }}>Value</Typography>
                                            <Box sx={{ width: 40 }} />
                                        </Box>

                                        {station.rows.map((row) => {
                                            const selectedParam = stationParams.find((p) => p.parameter_id === row.parameter_id);
                                            const rk = repKey(si, row.id);
                                            const reps = replicateInputs[rk] ?? [];
                                            const isExpanded = showReplicates.has(rk);
                                            const stats = getRepStats(si, row);
                                            return (
                                                <Box key={row.id} sx={{ mb: 1.5 }}>
                                                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                    <TextField
                                                        select
                                                        value={row.parameter_id}
                                                        onChange={(e) => updateRow(si, row.id, 'parameter_id', e.target.value)}
                                                        sx={{ flex: 3 }}
                                                        slotProps={{
                                                            select: {
                                                                renderValue: (val) => {
                                                                    const sp = stationParams.find(p => p.parameter_id === val);
                                                                    const dn = sp?.parameter?.[0]?.display_name;
                                                                    return dn ? `${dn} — ${sp?.name}` : (sp?.name ?? '');
                                                                },
                                                            },
                                                        }}
                                                    >
                                                        {stationParams.map((p) => {
                                                            const dn = p.parameter?.[0]?.display_name;
                                                            return (
                                                                <MenuItem key={p.parameter_id} value={p.parameter_id}>
                                                                    <Box>
                                                                        <Typography variant="body2">
                                                                            {dn ?? p.name}
                                                                            {p.display_units ? ` (${p.display_units})` : ''}
                                                                        </Typography>
                                                                        {dn && (
                                                                            <Typography variant="caption" color="text.secondary">
                                                                                {p.name}
                                                                            </Typography>
                                                                        )}
                                                                    </Box>
                                                                </MenuItem>
                                                            );
                                                        })}
                                                    </TextField>

                                                    <TextField
                                                        select
                                                        value={row.sensor_id}
                                                        onChange={(e) => updateRow(si, row.id, 'sensor_id', e.target.value)}
                                                        sx={{ flex: 2 }}
                                                    >
                                                        <MenuItem value=""><em>None</em></MenuItem>
                                                        {(sensors ?? []).map((s) => (
                                                            <MenuItem key={s.id} value={s.id}>
                                                                {s.serial_number ?? s.name ?? s.id.slice(0, 8)}
                                                                {s.manufacturer ? ` (${s.manufacturer})` : ''}
                                                            </MenuItem>
                                                        ))}
                                                    </TextField>

                                                    <TextField
                                                        value={row.value}
                                                        onChange={(e) => updateRow(si, row.id, 'value', e.target.value)}
                                                        type="number"
                                                        sx={{ flex: 1.5 }}
                                                        placeholder={selectedParam?.display_units ?? 'Value'}
                                                    />

                                                    <IconButton
                                                        onClick={() => removeRow(si, row.id)}
                                                        disabled={station.rows.length <= 1}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                    </Box>

                                                    {row.parameter_id && (
                                                        <Box sx={{ ml: 1, mt: 0.5 }}>
                                                            <Button
                                                                onClick={() => {
                                                                    setShowReplicates(prev => {
                                                                        const next = new Set(prev);
                                                                        if (next.has(rk)) next.delete(rk); else next.add(rk);
                                                                        return next;
                                                                    });
                                                                    if (!replicateInputs[rk]?.length) {
                                                                        setReplicateInputs(prev => ({ ...prev, [rk]: [''] }));
                                                                    }
                                                                }}
                                                                startIcon={isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                                sx={{ textTransform: 'none', fontSize: '0.8125rem' }}
                                                            >
                                                                Replicates
                                                                {stats && <Chip label={`n=${stats.count}`} sx={{ ml: 1, height: 20, fontSize: '0.7rem' }} />}
                                                            </Button>
                                                            <Collapse in={isExpanded}>
                                                                <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, ml: 2 }}>
                                                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                                                        The primary value above counts as the first measurement.
                                                                    </Typography>
                                                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                                                        {reps.map((rep, ri) => (
                                                                            <Box key={ri} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                                <TextField
                                                                                    type="number"
                                                                                    value={rep}
                                                                                    onChange={(e) => {
                                                                                        setReplicateInputs(prev => {
                                                                                            const arr = [...(prev[rk] ?? [])];
                                                                                            arr[ri] = e.target.value;
                                                                                            return { ...prev, [rk]: arr };
                                                                                        });
                                                                                    }}
                                                                                    placeholder={`Rep ${ri + 2}`}
                                                                                    sx={{ width: 90 }}
                                                                                    slotProps={{ input: { sx: { fontSize: '0.8125rem' } } }}
                                                                                />
                                                                                <IconButton onClick={() => {
                                                                                    setReplicateInputs(prev => {
                                                                                        const arr = [...(prev[rk] ?? [])];
                                                                                        arr.splice(ri, 1);
                                                                                        return { ...prev, [rk]: arr };
                                                                                    });
                                                                                }}>
                                                                                    <DeleteIcon sx={{ fontSize: 16 }} />
                                                                                </IconButton>
                                                                            </Box>
                                                                        ))}
                                                                        {reps.length < MAX_REPLICATES - 1 && (
                                                                            <Button
                                                                                onClick={() => setReplicateInputs(prev => ({
                                                                                    ...prev, [rk]: [...(prev[rk] ?? []), '']
                                                                                }))}
                                                                                startIcon={<AddIcon />}
                                                                                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                                                                            >
                                                                                Add
                                                                            </Button>
                                                                        )}
                                                                    </Box>
                                                                    {stats && (
                                                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                                            Mean: <strong>{stats.mean.toFixed(2)}</strong>
                                                                            {' ± '}{stats.sd.toFixed(2)}
                                                                            {' '}{selectedParam?.display_units ?? ''}
                                                                            {' '}(n={stats.count})
                                                                        </Typography>
                                                                    )}
                                                                </Paper>
                                                            </Collapse>
                                                        </Box>
                                                    )}
                                                </Box>
                                            );
                                        })}

                                        <Button startIcon={<AddIcon />} onClick={() => addRow(si)} sx={{ mt: 1 }}>
                                            Add Row
                                        </Button>
                                    </>
                                )}
                            </Paper>
                        );
                    })}

                    <Button variant="outlined" startIcon={<AddIcon />} onClick={addStation}>
                        Add Site
                    </Button>
                </Box>
            )}

            {/* Step 3: Review & Submit */}
            {activeStep === 2 && (
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Review</Typography>

                    <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">Date</Typography>
                        <Typography>{tripDate}</Typography>
                    </Box>

                    {participants && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="body2" color="text.secondary">Participants</Typography>
                            <Typography>{participants}</Typography>
                        </Box>
                    )}

                    {tripNotes && (
                        <Box sx={{ mb: 2 }}>
                            <Typography variant="body2" color="text.secondary">Notes</Typography>
                            <Typography>{tripNotes}</Typography>
                        </Box>
                    )}

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        {summaryData.length} site{summaryData.length !== 1 ? 's' : ''}, {totalReadings} reading{totalReadings !== 1 ? 's' : ''}
                    </Typography>

                    {summaryData.map((s, i) => (
                        <Box key={i} sx={{ mb: 2 }}>
                            <Typography variant="subtitle2">{s.siteName}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                {new Date(s.dateTime).toLocaleString()}
                            </Typography>
                            <List dense disablePadding>
                                {s.readings.map((r, j) => (
                                    <ListItem key={j} disableGutters sx={{ py: 0 }}>
                                        <ListItemText
                                            primary={`${r.paramName}: ${r.value} ${r.units}`}
                                            primaryTypographyProps={{ variant: 'body2' }}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Box>
                    ))}
                </Paper>
            )}

            {/* Navigation */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
                <Button
                    onClick={handleBack}
                    disabled={activeStep === 0}
                    startIcon={<NavigateBeforeIcon />}
                >
                    Back
                </Button>

                {activeStep < STEPS.length - 1 ? (
                    <Button
                        variant="contained"
                        onClick={handleNext}
                        endIcon={<NavigateNextIcon />}
                    >
                        Next
                    </Button>
                ) : (
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={submitting}
                        startIcon={submitting ? <CircularProgress size={16} /> : <SendIcon />}
                    >
                        Submit Field Trip
                    </Button>
                )}
            </Box>

            <Snackbar
                open={!!successInfo}
                autoHideDuration={6000}
                onClose={() => setSuccessInfo(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSuccessInfo(null)} severity="success" variant="filled">
                    {successInfo && `Field trip recorded: ${successInfo.count} reading${successInfo.count !== 1 ? 's' : ''} across all sites`}
                </Alert>
            </Snackbar>
        </Box>
    );
};
