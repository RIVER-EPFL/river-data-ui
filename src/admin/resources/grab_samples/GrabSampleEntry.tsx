import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
    useGetList,
    useNotify,
    Title,
} from 'react-admin';
import {
    Box,
    Typography,
    Alert,
    Button,
    TextField,
    MenuItem,
    IconButton,
    Paper,
    Divider,
    CircularProgress,
    Snackbar,
    Switch,
    FormControlLabel,
    Collapse,
    Chip,
    Tooltip,
    Drawer,
    Fab,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SendIcon from '@mui/icons-material/Send';
import ScienceIcon from '@mui/icons-material/Science';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BuildIcon from '@mui/icons-material/Build';
import { useAuthFetch } from '../../hooks/useAuthFetch';

interface SiteRecord {
    id: string;
    name: string;
    project_id: string | null;
    altitude_m: number | null;
}

interface SiteParameterRecord {
    id: string;
    site_id: string;
    parameter_id: string;
    name: string;
    display_units: string | null;
    is_active: boolean | null;
    is_derived: boolean | null;
}

interface SensorRecord {
    id: string;
    serial_number: string | null;
    name: string | null;
    parameter_id: string;
    manufacturer: string | null;
    model: string | null;
    is_active: boolean | null;
    is_lab_instrument: boolean | null;
}

interface StandardCurveRecord {
    id: string;
    parameter_id: string;
    valid_from: string;
    slope: number;
    intercept: number;
    r_squared: number | null;
}

interface ReadingRow {
    id: number;
    parameter_id: string;
    sensor_id: string;
    value: string;
}

// Barometric pressure from altitude (hypsometric formula, result in Pa then convert to kPa)
const calcBarometricPressure = (altitudeM: number): number =>
    101325 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588) / 1000;

// Apply inverse standard curve correction: corrected = (raw - intercept) / slope
const applyCorrection = (curve: StandardCurveRecord, rawValue: number): number =>
    (rawValue - curve.intercept) / curve.slope;

// Sample standard deviation
const sampleStdDev = (values: number[]): number => {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
};

// Detect depth-type parameters by name
const isDepthParameter = (name: string): boolean =>
    name.toLowerCase().includes('depth');

const MAX_REPLICATES = 10;

// Tool definitions: name matching is based on lowercase parameter names in the form
const TOOL_DEFS: Array<{ name: string; displayName: string; apiName: string; match: (names: Set<string>) => boolean }> = [
    { name: 'doc', displayName: 'DOC Calculator', apiName: 'doc', match: (ns) => [...ns].some(n => n.includes('doc') || n.includes('organic carbon')) },
    { name: 'pco2', displayName: 'pCO2 Calculator', apiName: 'pco2', match: (ns) => [...ns].some(n => n.includes('co2') || n.includes('ph') || n.includes('alkalinity')) },
    { name: 'dic', displayName: 'DIC Calculator', apiName: 'dic', match: (ns) => [...ns].some(n => n.includes('dic') || n.includes('alkalinity')) },
    { name: 'chlorophyll', displayName: 'Chlorophyll Calculator', apiName: 'chlorophyll', match: (ns) => [...ns].some(n => n.includes('chlorophyll') || n.includes('chl')) },
    { name: 'alkalinity', displayName: 'Alkalinity Calculator', apiName: 'alkalinity', match: (ns) => [...ns].some(n => n.includes('alkalinity') || n.includes('alk')) },
    { name: 'tss_afdm', displayName: 'TSS / AFDM', apiName: 'tss_afdm', match: (ns) => [...ns].some(n => n.includes('tss') || n.includes('afdm') || n.includes('suspended')) },
    { name: 'dom', displayName: 'DOM Processing', apiName: 'dom', match: (ns) => [...ns].some(n => n.includes('dom') || n.includes('dissolved organic')) },
    { name: 'ions', displayName: 'Ions Calculator', apiName: 'ions', match: (ns) => [...ns].some(n => n.includes('ion') || n.includes('anion') || n.includes('cation')) },
    { name: 'field_data', displayName: 'Field Data Processing', apiName: 'field_data', match: () => true },
];

interface ToolSidebarProps {
    rows: ReadingRow[];
    paramById: Map<string, SiteParameterRecord>;
    siteId: string;
    barometricPressure: number | null;
    onApplyResult: (parameterId: string, value: number) => void;
}

const ToolSidebar: React.FC<ToolSidebarProps> = ({ rows, paramById, barometricPressure, onApplyResult }) => {
    const authFetch = useAuthFetch();

    const enteredParams = useMemo(() => {
        return rows
            .filter(r => r.parameter_id && r.value)
            .map(r => ({
                paramId: r.parameter_id,
                name: paramById.get(r.parameter_id)?.name ?? '',
                value: parseFloat(r.value),
            }));
    }, [rows, paramById]);

    const applicableTools = useMemo(() => {
        if (enteredParams.length === 0) return [];
        const paramNames = new Set(enteredParams.map(p => p.name.toLowerCase()));
        return TOOL_DEFS.filter(t => t.match(paramNames));
    }, [enteredParams]);

    const [expandedTool, setExpandedTool] = useState<string | null>(null);
    const [calculating, setCalculating] = useState(false);
    const [results, setResults] = useState<Record<string, unknown> | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleCalculate = async (apiName: string) => {
        setCalculating(true);
        setError(null);
        setResults(null);
        try {
            const inputs: Record<string, unknown> = {};
            for (const ep of enteredParams) {
                inputs[ep.name.toLowerCase().replace(/\s/g, '_')] = ep.value;
            }
            if (barometricPressure != null) {
                inputs['barometric_pressure'] = barometricPressure;
            }

            const resp = await authFetch(`/api/service/tools/${apiName}/calculate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(inputs),
            });
            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(text || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            setResults(data.results);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Calculation failed');
        } finally {
            setCalculating(false);
        }
    };

    return (
        <Box sx={{ width: 350, p: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Calculation Tools</Typography>

            {applicableTools.length === 0 ? (
                <Alert severity="info">Enter parameter values to see applicable tools</Alert>
            ) : (
                applicableTools.map(tool => (
                    <Paper key={tool.name} variant="outlined" sx={{ mb: 1.5 }}>
                        <Button
                            fullWidth
                            onClick={() => {
                                setExpandedTool(expandedTool === tool.name ? null : tool.name);
                                setResults(null);
                                setError(null);
                            }}
                            sx={{ justifyContent: 'space-between', textTransform: 'none', p: 1.5 }}
                            endIcon={expandedTool === tool.name ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        >
                            {tool.displayName}
                        </Button>
                        <Collapse in={expandedTool === tool.name}>
                            <Box sx={{ p: 1.5, pt: 0 }}>
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                    Using values: {enteredParams.map(p => p.name).join(', ')}
                                </Typography>
                                <Button
                                    size="small"
                                    variant="contained"
                                    onClick={() => handleCalculate(tool.apiName)}
                                    disabled={calculating}
                                    startIcon={calculating ? <CircularProgress size={14} /> : null}
                                >
                                    Calculate
                                </Button>
                                {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
                                {results && (
                                    <Box sx={{ mt: 1 }}>
                                        {Object.entries(results)
                                            .filter(([, v]) => v != null && typeof v === 'number')
                                            .map(([key, value]) => (
                                                <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
                                                    <Typography variant="body2">
                                                        {key.replace(/_/g, ' ')}: <strong>{(value as number).toFixed(4)}</strong>
                                                    </Typography>
                                                    <Button
                                                        size="small"
                                                        onClick={() => {
                                                            const match = [...paramById.entries()].find(([, sp]) =>
                                                                sp.name.toLowerCase().replace(/[_\s]/g, '').includes(key.toLowerCase().replace(/_/g, ''))
                                                            );
                                                            if (match) onApplyResult(match[0], value as number);
                                                        }}
                                                        sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto' }}
                                                    >
                                                        Apply
                                                    </Button>
                                                </Box>
                                            ))}
                                    </Box>
                                )}
                            </Box>
                        </Collapse>
                    </Paper>
                ))
            )}
        </Box>
    );
};

const GrabSampleEntry: React.FC = () => {
    const notify = useNotify();
    const authFetch = useAuthFetch();

    const [siteId, setSiteId] = useState('');
    const [dateTime, setDateTime] = useState(() => {
        const now = new Date();
        now.setSeconds(0, 0);
        return now.toISOString().slice(0, 16);
    });
    const [rows, setRows] = useState<ReadingRow[]>([
        { id: 1, parameter_id: '', sensor_id: '', value: '' },
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [successInfo, setSuccessInfo] = useState<{ count: number; siteName: string } | null>(null);
    const [nextId, setNextId] = useState(2);

    // Depth replicate state: rowId → array of replicate values
    const [replicateInputs, setReplicateInputs] = useState<Record<number, string[]>>({});
    // Which rows have replicates expanded
    const [showReplicates, setShowReplicates] = useState<Set<number>>(new Set());
    // Standard curve correction toggle: rowId → enabled
    const [correctionEnabled, setCorrectionEnabled] = useState<Record<number, boolean>>({});
    // Manual override: rowId → override value (empty = use calculated)
    const [overrideValues, setOverrideValues] = useState<Record<number, string>>({});
    // Quantile cache for distribution-based validation warnings
    const [quantileCache, setQuantileCache] = useState<Map<string, { p5: number; p95: number }>>(new Map());
    // Tool sidebar state
    const [toolDrawerOpen, setToolDrawerOpen] = useState(false);

    // Fetch sites (including altitude_m)
    const { data: sites } = useGetList<SiteRecord>('sites', {
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    });

    // Fetch parameters for selected site
    const { data: siteParameters } = useGetList<SiteParameterRecord>('site_parameters', {
        filter: { site_id: siteId, is_active: true },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'name', order: 'ASC' },
    }, { enabled: !!siteId });

    // Fetch lab instrument sensors
    const { data: sensors } = useGetList<SensorRecord>('sensors', {
        filter: { is_lab_instrument: true, is_active: true },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'serial_number', order: 'ASC' },
    });

    // Fetch standard curves (sorted by valid_from DESC)
    const { data: standardCurves } = useGetList<StandardCurveRecord>('standard_curves', {
        pagination: { page: 1, perPage: 500 },
        sort: { field: 'valid_from', order: 'DESC' },
    });

    // Non-derived parameters only
    const measurableParams = useMemo(
        () => (siteParameters ?? []).filter((p) => !p.is_derived),
        [siteParameters],
    );

    // Map parameter_id -> SiteParameterRecord
    const paramById = useMemo(() => {
        const map = new Map<string, SiteParameterRecord>();
        measurableParams.forEach((p) => map.set(p.parameter_id, p));
        return map;
    }, [measurableParams]);

    // Selected site record
    const selectedSite = useMemo(
        () => sites?.find((s) => s.id === siteId) ?? null,
        [sites, siteId],
    );

    // Barometric pressure from altitude
    const barometricPressure = useMemo(
        () => selectedSite?.altitude_m != null ? calcBarometricPressure(selectedSite.altitude_m) : null,
        [selectedSite],
    );

    // Active standard curve map: parameter_id → most recent valid curve
    const activeCurveMap = useMemo(() => {
        const map = new Map<string, StandardCurveRecord>();
        if (!standardCurves) return map;
        const ts = dateTime ? new Date(dateTime).toISOString() : new Date().toISOString();
        for (const curve of standardCurves) {
            if (!map.has(curve.parameter_id) && curve.valid_from <= ts) {
                map.set(curve.parameter_id, curve);
            }
        }
        return map;
    }, [standardCurves, dateTime]);

    // Compute UTC display
    const utcDisplay = useMemo(() => {
        if (!dateTime) return '';
        try {
            return new Date(dateTime).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        } catch {
            return '';
        }
    }, [dateTime]);

    // Compute replicate stats for a row
    const getReplicateStats = useCallback((row: ReadingRow) => {
        const reps = replicateInputs[row.id];
        if (!reps || reps.length === 0) return null;
        const allValues = [row.value, ...reps]
            .map((v) => parseFloat(v))
            .filter((v) => !isNaN(v));
        if (allValues.length < 2) return null;
        const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        const sd = sampleStdDev(allValues);
        return { mean, sd, count: allValues.length };
    }, [replicateInputs]);

    // Get the effective value for a row (replicates → correction → override)
    const getEffectiveValue = useCallback((row: ReadingRow): number => {
        // Manual override takes precedence
        const override = overrideValues[row.id];
        if (override && !isNaN(parseFloat(override))) return parseFloat(override);

        // Start with raw value or replicate mean
        const repStats = getReplicateStats(row);
        let value = repStats ? repStats.mean : parseFloat(row.value);
        if (isNaN(value)) return value;

        // Apply standard curve correction if enabled
        const curve = activeCurveMap.get(row.parameter_id);
        if (curve && correctionEnabled[row.id]) {
            value = applyCorrection(curve, value);
        }

        return value;
    }, [overrideValues, getReplicateStats, activeCurveMap, correctionEnabled]);

    const fetchQuantiles = useCallback(async (paramId: string) => {
        const cacheKey = `${siteId}:${paramId}`;
        if (quantileCache.has(cacheKey)) return;

        try {
            const now = new Date();
            const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            const url = `/api/service/sites/${siteId}/readings?start=${start.toISOString()}&parameter_ids=${paramId}&page_size=100000&format=json`;

            const res = await authFetch(url);
            if (!res.ok) return;

            const data = await res.json();
            if (!data.parameters?.length || !data.times?.length) return;

            const values = data.parameters[0].values.filter((v: number | null) => v != null) as number[];
            if (values.length < 10) return; // Need enough data for meaningful quantiles

            values.sort((a: number, b: number) => a - b);
            const p5 = values[Math.floor(values.length * 0.05)];
            const p95 = values[Math.ceil(values.length * 0.95) - 1];

            setQuantileCache(prev => {
                const next = new Map(prev);
                next.set(cacheKey, { p5, p95 });
                return next;
            });
        } catch (err) {
            console.error('Failed to fetch quantile data for validation:', err);
        }
    }, [siteId, authFetch, quantileCache]);

    useEffect(() => {
        if (!siteId) return;
        const timer = setTimeout(() => {
            for (const row of rows) {
                if (row.parameter_id && row.value) {
                    fetchQuantiles(row.parameter_id);
                }
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [rows, siteId, fetchQuantiles]);

    const getQuantileWarning = useCallback((paramId: string, value: number): string | null => {
        const cacheKey = `${siteId}:${paramId}`;
        const quantiles = quantileCache.get(cacheKey);
        if (!quantiles) return null;
        if (value < quantiles.p5 || value > quantiles.p95) {
            return `Value ${value} is outside typical range [${quantiles.p5.toFixed(2)} – ${quantiles.p95.toFixed(2)}] for this station`;
        }
        return null;
    }, [siteId, quantileCache]);

    const addRow = () => {
        setRows((prev) => [...prev, { id: nextId, parameter_id: '', sensor_id: '', value: '' }]);
        setNextId((n) => n + 1);
    };

    const removeRow = (id: number) => {
        setRows((prev) => prev.filter((r) => r.id !== id));
        // Clean up per-row state
        setReplicateInputs((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setShowReplicates((prev) => { const next = new Set(prev); next.delete(id); return next; });
        setCorrectionEnabled((prev) => { const next = { ...prev }; delete next[id]; return next; });
        setOverrideValues((prev) => { const next = { ...prev }; delete next[id]; return next; });
    };

    const updateRow = (id: number, field: keyof ReadingRow, value: string) => {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    };

    const updateReplicate = (rowId: number, index: number, value: string) => {
        setReplicateInputs((prev) => {
            const reps = [...(prev[rowId] ?? [])];
            reps[index] = value;
            return { ...prev, [rowId]: reps };
        });
    };

    const addReplicate = (rowId: number) => {
        setReplicateInputs((prev) => {
            const reps = prev[rowId] ?? [];
            if (reps.length >= MAX_REPLICATES - 1) return prev; // -1 because primary value counts
            return { ...prev, [rowId]: [...reps, ''] };
        });
    };

    const removeReplicate = (rowId: number, index: number) => {
        setReplicateInputs((prev) => {
            const reps = [...(prev[rowId] ?? [])];
            reps.splice(index, 1);
            return { ...prev, [rowId]: reps };
        });
    };

    const resetForm = () => {
        setRows([{ id: nextId, parameter_id: '', sensor_id: '', value: '' }]);
        setNextId((n) => n + 1);
        setReplicateInputs({});
        setShowReplicates(new Set());
        setCorrectionEnabled({});
        setOverrideValues({});
    };

    const handleApplyToolResult = useCallback((parameterId: string, value: number) => {
        setRows(prev => prev.map(r =>
            r.parameter_id === parameterId ? { ...r, value: value.toString() } : r
        ));
        notify(`Applied ${value.toFixed(4)} to form`, { type: 'success' });
    }, [notify]);

    const validate = (): string | null => {
        if (!siteId) return 'Please select a station';
        if (!dateTime) return 'Please set a date/time';

        const validRows = rows.filter((r) => r.parameter_id || r.value);
        if (validRows.length === 0) return 'Add at least one reading';

        for (const row of validRows) {
            if (!row.parameter_id) return 'Each row needs a parameter selected';
            // For depth with replicates, value can be empty if replicates provide the mean
            const repStats = getReplicateStats(row);
            if (repStats) continue; // replicates provide the value
            if (!row.value || isNaN(parseFloat(row.value)))
                return `Invalid value for ${paramById.get(row.parameter_id)?.name ?? 'parameter'}`;
        }

        // Check for duplicate parameters
        const paramIds = validRows.map((r) => r.parameter_id);
        if (new Set(paramIds).size !== paramIds.length)
            return 'Duplicate parameters found \u2014 use replicates within a row for repeated measurements';

        return null;
    };

    const handleSubmit = async () => {
        const error = validate();
        if (error) {
            notify(error, { type: 'warning' });
            return;
        }

        const validRows = rows.filter((r) => r.parameter_id && (r.value || getReplicateStats(r)));
        const timestamp = new Date(dateTime).toISOString();

        const readings = validRows.map((row) => ({
            parameter_id: row.parameter_id,
            sensor_id: row.sensor_id || null,
            value: getEffectiveValue(row),
            time: timestamp,
        }));

        const payload = { site_id: siteId, readings };

        setSubmitting(true);
        try {
            const response = await authFetch('/api/service/grab_samples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(err.error || 'Failed to submit');
            }

            const result = await response.json();
            const siteName = sites?.find((s) => s.id === siteId)?.name ?? 'site';
            setSuccessInfo({ count: result.inserted, siteName });
            resetForm();
        } catch (e) {
            notify(`Failed: ${e instanceof Error ? e.message : 'Unknown error'}`, { type: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Box sx={{ p: 2, maxWidth: 900 }}>
            <Title title="Enter Grab Samples" />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <ScienceIcon color="primary" />
                <Typography variant="h5">Enter Grab Samples</Typography>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
                {/* Station and DateTime selectors */}
                <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                    <TextField
                        select
                        label="Station"
                        value={siteId}
                        onChange={(e) => {
                            setSiteId(e.target.value);
                            setQuantileCache(new Map());
                            resetForm();
                        }}
                        sx={{ minWidth: 250 }}
                        size="small"
                    >
                        {(sites ?? []).map((s) => (
                            <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
                        ))}
                    </TextField>

                    <Box>
                        <TextField
                            label="Date / Time (local)"
                            type="datetime-local"
                            value={dateTime}
                            onChange={(e) => setDateTime(e.target.value)}
                            size="small"
                            slotProps={{ inputLabel: { shrink: true } }}
                            sx={{ minWidth: 220 }}
                        />
                        {utcDisplay && (
                            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
                                {utcDisplay}
                            </Typography>
                        )}
                    </Box>
                </Box>

                {/* Barometric pressure from altitude */}
                {siteId && (
                    <TextField
                        label="Barometric Pressure (est.)"
                        value={
                            barometricPressure != null
                                ? `${barometricPressure.toFixed(1)} kPa (from ${selectedSite?.altitude_m} m altitude)`
                                : 'N/A'
                        }
                        size="small"
                        slotProps={{ input: { readOnly: true } }}
                        sx={{ mb: 2, minWidth: 320 }}
                        helperText={barometricPressure == null ? 'Station has no altitude configured' : undefined}
                    />
                )}

                <Divider sx={{ mb: 2 }} />

                {/* Parameter rows */}
                {!siteId ? (
                    <Alert severity="info">Select a station to begin entering samples</Alert>
                ) : (
                    <>
                        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                            <Typography variant="body2" sx={{ flex: 3, fontWeight: 600 }}>Parameter</Typography>
                            <Typography variant="body2" sx={{ flex: 2, fontWeight: 600 }}>Instrument</Typography>
                            <Typography variant="body2" sx={{ flex: 1.5, fontWeight: 600 }}>Value</Typography>
                            <Box sx={{ width: 40 }} />
                        </Box>

                        {rows.map((row) => {
                            const selectedParam = paramById.get(row.parameter_id);
                            const isDepth = selectedParam ? isDepthParameter(selectedParam.name) : false;
                            const activeCurve = row.parameter_id ? activeCurveMap.get(row.parameter_id) : undefined;
                            const repStats = getReplicateStats(row);
                            const reps = replicateInputs[row.id] ?? [];
                            const isExpanded = showReplicates.has(row.id);
                            const isCorrectionOn = !!correctionEnabled[row.id];
                            const hasOverride = overrideValues[row.id] && overrideValues[row.id] !== '';

                            // Compute display values
                            const baseValue = repStats ? repStats.mean : parseFloat(row.value);
                            const correctedValue = activeCurve && !isNaN(baseValue)
                                ? applyCorrection(activeCurve, baseValue) : null;
                            const effectiveValue = getEffectiveValue(row);

                            return (
                                <Box key={row.id} sx={{ mb: 2 }}>
                                    {/* Main row */}
                                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                        <TextField
                                            select
                                            value={row.parameter_id}
                                            onChange={(e) => {
                                                updateRow(row.id, 'parameter_id', e.target.value);
                                                // Reset row-level state on parameter change
                                                setCorrectionEnabled((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                                                setOverrideValues((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                                                setReplicateInputs((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                                                setShowReplicates((prev) => { const n = new Set(prev); n.delete(row.id); return n; });
                                            }}
                                            size="small"
                                            sx={{ flex: 3 }}
                                            placeholder="Select parameter"
                                        >
                                            {measurableParams.map((p) => (
                                                <MenuItem key={p.parameter_id} value={p.parameter_id}>
                                                    {p.name} {p.display_units ? `(${p.display_units})` : ''}
                                                </MenuItem>
                                            ))}
                                        </TextField>

                                        <TextField
                                            select
                                            value={row.sensor_id}
                                            onChange={(e) => updateRow(row.id, 'sensor_id', e.target.value)}
                                            size="small"
                                            sx={{ flex: 2 }}
                                        >
                                            <MenuItem value="">
                                                <em>None</em>
                                            </MenuItem>
                                            {(sensors ?? []).map((s) => (
                                                <MenuItem key={s.id} value={s.id}>
                                                    {s.serial_number ?? s.name ?? s.id.slice(0, 8)}
                                                    {s.manufacturer ? ` (${s.manufacturer})` : ''}
                                                </MenuItem>
                                            ))}
                                        </TextField>

                                        <TextField
                                            value={row.value}
                                            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                                            size="small"
                                            type="number"
                                            sx={{ flex: 1.5 }}
                                            placeholder={selectedParam?.display_units ?? 'Value'}
                                        />

                                        {(() => {
                                            const val = parseFloat(row.value);
                                            const warning = !isNaN(val) && row.parameter_id ? getQuantileWarning(row.parameter_id, val) : null;
                                            return warning ? (
                                                <Tooltip title={warning}>
                                                    <WarningAmberIcon sx={{ color: 'warning.main', fontSize: 20, ml: -0.5 }} />
                                                </Tooltip>
                                            ) : null;
                                        })()}

                                        <IconButton
                                            size="small"
                                            onClick={() => removeRow(row.id)}
                                            disabled={rows.length <= 1}
                                        >
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Box>

                                    {/* Sub-controls: replicates, correction, override */}
                                    {row.parameter_id && (
                                        <Box sx={{ ml: 1, mt: 0.5 }}>
                                            {/* Depth replicates */}
                                            {isDepth && (
                                                <Box sx={{ mb: 0.5 }}>
                                                    <Button
                                                        size="small"
                                                        onClick={() => {
                                                            setShowReplicates((prev) => {
                                                                const next = new Set(prev);
                                                                if (next.has(row.id)) next.delete(row.id);
                                                                else next.add(row.id);
                                                                return next;
                                                            });
                                                            // Auto-add first replicate if none exist
                                                            if (!replicateInputs[row.id]?.length) {
                                                                setReplicateInputs((prev) => ({
                                                                    ...prev,
                                                                    [row.id]: [''],
                                                                }));
                                                            }
                                                        }}
                                                        startIcon={isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                        sx={{ textTransform: 'none', fontSize: '0.8rem' }}
                                                    >
                                                        Depth Replicates
                                                        {repStats && (
                                                            <Chip
                                                                label={`n=${repStats.count}`}
                                                                size="small"
                                                                sx={{ ml: 1, height: 20, fontSize: '0.7rem' }}
                                                            />
                                                        )}
                                                    </Button>

                                                    <Collapse in={isExpanded}>
                                                        <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, ml: 2 }}>
                                                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                                                Enter replicate measurements. The primary value above counts as the first measurement.
                                                            </Typography>
                                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                                                                {reps.map((rep, i) => (
                                                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                        <TextField
                                                                            size="small"
                                                                            type="number"
                                                                            value={rep}
                                                                            onChange={(e) => updateReplicate(row.id, i, e.target.value)}
                                                                            placeholder={`Rep ${i + 2}`}
                                                                            sx={{ width: 90 }}
                                                                            slotProps={{ input: { sx: { fontSize: '0.8rem' } } }}
                                                                        />
                                                                        <IconButton
                                                                            size="small"
                                                                            onClick={() => removeReplicate(row.id, i)}
                                                                        >
                                                                            <DeleteIcon sx={{ fontSize: 16 }} />
                                                                        </IconButton>
                                                                    </Box>
                                                                ))}
                                                                {reps.length < MAX_REPLICATES - 1 && (
                                                                    <Button
                                                                        size="small"
                                                                        onClick={() => addReplicate(row.id)}
                                                                        startIcon={<AddIcon />}
                                                                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                                                                    >
                                                                        Add
                                                                    </Button>
                                                                )}
                                                            </Box>
                                                            {repStats && (
                                                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                                    Mean: <strong>{repStats.mean.toFixed(2)}</strong>
                                                                    {' \u00B1 '}{repStats.sd.toFixed(2)}
                                                                    {' '}{selectedParam?.display_units ?? ''}
                                                                    {' '}(n={repStats.count})
                                                                </Typography>
                                                            )}
                                                        </Paper>
                                                    </Collapse>
                                                </Box>
                                            )}

                                            {/* Standard curve correction */}
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                                {activeCurve ? (
                                                    <>
                                                        <FormControlLabel
                                                            control={
                                                                <Switch
                                                                    size="small"
                                                                    checked={isCorrectionOn}
                                                                    onChange={(e) =>
                                                                        setCorrectionEnabled((prev) => ({
                                                                            ...prev,
                                                                            [row.id]: e.target.checked,
                                                                        }))
                                                                    }
                                                                />
                                                            }
                                                            label={
                                                                <Typography variant="caption">
                                                                    Apply correction
                                                                </Typography>
                                                            }
                                                            sx={{ mr: 0 }}
                                                        />
                                                        {isCorrectionOn && correctedValue != null && !isNaN(baseValue) && (
                                                            <Chip
                                                                label={`Corrected: ${correctedValue.toFixed(3)}`}
                                                                size="small"
                                                                color="info"
                                                                sx={{ fontSize: '0.75rem', height: 24 }}
                                                            />
                                                        )}
                                                        <Typography variant="caption" color="text.secondary">
                                                            y = (x \u2212 {activeCurve.intercept}) / {activeCurve.slope}
                                                            {activeCurve.r_squared != null && `, R\u00B2=${activeCurve.r_squared}`}
                                                        </Typography>
                                                    </>
                                                ) : (
                                                    <FormControlLabel
                                                        control={<Switch size="small" disabled />}
                                                        label={
                                                            <Typography variant="caption" color="text.disabled">
                                                                No standard curve
                                                            </Typography>
                                                        }
                                                    />
                                                )}
                                            </Box>

                                            {/* Manual override */}
                                            {(repStats || (isCorrectionOn && activeCurve)) && (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                                                    <TextField
                                                        size="small"
                                                        type="number"
                                                        label="Override final value"
                                                        value={overrideValues[row.id] ?? ''}
                                                        onChange={(e) =>
                                                            setOverrideValues((prev) => ({
                                                                ...prev,
                                                                [row.id]: e.target.value,
                                                            }))
                                                        }
                                                        sx={{ width: 180 }}
                                                        slotProps={{
                                                            input: { sx: { fontSize: '0.8rem' } },
                                                            inputLabel: { shrink: true },
                                                        }}
                                                    />
                                                    {hasOverride && (
                                                        <Button
                                                            size="small"
                                                            onClick={() =>
                                                                setOverrideValues((prev) => {
                                                                    const n = { ...prev };
                                                                    delete n[row.id];
                                                                    return n;
                                                                })
                                                            }
                                                            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                                                        >
                                                            Clear
                                                        </Button>
                                                    )}
                                                    {!isNaN(effectiveValue) && (
                                                        <Typography variant="caption" color="text.secondary">
                                                            Submitting: <strong>{effectiveValue.toFixed(3)}</strong>
                                                        </Typography>
                                                    )}
                                                </Box>
                                            )}
                                        </Box>
                                    )}
                                </Box>
                            );
                        })}

                        <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={addRow}
                            sx={{ mt: 1 }}
                        >
                            Add Row
                        </Button>
                    </>
                )}
            </Paper>

            {/* Submit */}
            {siteId && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={submitting}
                        startIcon={submitting ? <CircularProgress size={16} /> : <SendIcon />}
                        size="large"
                    >
                        Submit Grab Samples
                    </Button>
                </Box>
            )}

            {/* Success confirmation */}
            <Snackbar
                open={!!successInfo}
                autoHideDuration={6000}
                onClose={() => setSuccessInfo(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert onClose={() => setSuccessInfo(null)} severity="success" variant="filled">
                    {successInfo && `${successInfo.count} grab sample${successInfo.count !== 1 ? 's' : ''} recorded for ${successInfo.siteName}`}
                </Alert>
            </Snackbar>

            {siteId && (
                <>
                    <Fab
                        color="primary"
                        sx={{ position: 'fixed', bottom: 24, right: 24 }}
                        onClick={() => setToolDrawerOpen(true)}
                    >
                        <BuildIcon />
                    </Fab>
                    <Drawer
                        anchor="right"
                        open={toolDrawerOpen}
                        onClose={() => setToolDrawerOpen(false)}
                    >
                        <ToolSidebar
                            rows={rows}
                            paramById={paramById}
                            siteId={siteId}
                            barometricPressure={barometricPressure}
                            onApplyResult={handleApplyToolResult}
                        />
                    </Drawer>
                </>
            )}
        </Box>
    );
};

export default GrabSampleEntry;
