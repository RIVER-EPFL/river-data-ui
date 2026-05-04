import React, { useState, useCallback } from 'react';
import { useGetList, useNotify } from 'react-admin';
import {
    Box,
    Typography,
    Collapse,
    IconButton,
    Chip,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    CircularProgress,
    Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ScienceIcon from '@mui/icons-material/Science';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../../hooks/useAuthFetch';
import { tokens } from '../../theme';

interface SampleRecord {
    id: string;
    site_id: string;
    parameter_id: string;
    collected_at: string;
    label: string | null;
    notes: string | null;
    created_by: string | null;
    mean: number | null;
    stdev: number | null;
    n: number;
    min_value: number | null;
    max_value: number | null;
}

interface SiteParameterRecord {
    id: string;
    parameter_id: string;
    name: string;
    display_units: string | null;
}

interface ReplicateReading {
    parameter_id: string;
    time: string;
    value: number;
    is_flagged: boolean | null;
    flag_reason: string | null;
}

interface GrabSamplesSectionProps {
    siteId: string;
    projectId?: string;
    parameters: SiteParameterRecord[];
}

export const GrabSamplesSection: React.FC<GrabSamplesSectionProps> = ({ siteId, projectId, parameters }) => {
    const notify = useNotify();
    const navigate = useNavigate();
    const authFetch = useAuthFetch();

    const paramByGlobalId = new Map(parameters.map(p => [p.parameter_id, p]));

    const { data: samples, isLoading, refetch } = useGetList<SampleRecord>('samples', {
        filter: { site_id: siteId },
        pagination: { page: 1, perPage: 200 },
        sort: { field: 'collected_at', order: 'DESC' },
    });

    const [expandedSample, setExpandedSample] = useState<string | null>(null);
    const [replicates, setReplicates] = useState<ReplicateReading[]>([]);
    const [loadingReplicates, setLoadingReplicates] = useState(false);

    const toggleExpand = useCallback(async (sampleId: string) => {
        if (expandedSample === sampleId) {
            setExpandedSample(null);
            return;
        }
        setExpandedSample(sampleId);
        setLoadingReplicates(true);
        try {
            const res = await authFetch(
                `/api/service/sites/${siteId}/readings?sample_id=${sampleId}&include_replicates=true&page_size=100&format=json`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const rows: ReplicateReading[] = [];
            if (data.times?.length && data.parameters?.length) {
                const param = data.parameters[0];
                for (let i = 0; i < data.times.length; i++) {
                    if (param.values[i] != null) {
                        rows.push({
                            parameter_id: param.id,
                            time: data.times[i],
                            value: param.values[i],
                            is_flagged: param.flagged?.[i] ?? null,
                            flag_reason: param.flag_reasons?.[i] ?? null,
                        });
                    }
                }
            }
            setReplicates(rows);
        } catch (e) {
            notify(`Failed to load replicates: ${e instanceof Error ? e.message : 'error'}`, { type: 'error' });
            setReplicates([]);
        } finally {
            setLoadingReplicates(false);
        }
    }, [expandedSample, authFetch, siteId, notify]);

    const formatDate = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}><CircularProgress /></Box>;
    }

    if (!samples?.length) {
        return (
            <Box sx={{ p: 2 }}>
                <Alert severity="info" action={
                    <Button color="inherit" onClick={() => navigate(`/admin/grab-samples?siteId=${siteId}${projectId ? `&projectId=${projectId}` : ''}`)}>
                        Enter Samples
                    </Button>
                }>
                    No grab samples with replicates recorded for this site.
                </Alert>
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Button
                    startIcon={<ScienceIcon />}
                    onClick={() => navigate(`/admin/grab-samples?siteId=${siteId}${projectId ? `&projectId=${projectId}` : ''}`)}
                    sx={{ textTransform: 'none' }}
                >
                    Enter New Samples
                </Button>
            </Box>

            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell width={40} />
                            <TableCell>Date</TableCell>
                            <TableCell>Parameter</TableCell>
                            <TableCell align="right">Mean</TableCell>
                            <TableCell align="right">Stdev</TableCell>
                            <TableCell align="center">n</TableCell>
                            <TableCell>Label</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {samples.map((sample) => {
                            const param = paramByGlobalId.get(sample.parameter_id);
                            const isExpanded = expandedSample === sample.id;
                            return (
                                <React.Fragment key={sample.id}>
                                    <TableRow
                                        hover
                                        sx={{ cursor: 'pointer', '& > td': { borderBottom: isExpanded ? 'none' : undefined } }}
                                        onClick={() => toggleExpand(sample.id)}
                                    >
                                        <TableCell>
                                            <IconButton>
                                                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                            </IconButton>
                                        </TableCell>
                                        <TableCell>{formatDate(sample.collected_at)}</TableCell>
                                        <TableCell>
                                            {param?.name ?? sample.parameter_id.slice(0, 8)}
                                            {param?.display_units && (
                                                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                                                    ({param.display_units})
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell align="right">
                                            {sample.mean != null ? sample.mean.toFixed(3) : '—'}
                                        </TableCell>
                                        <TableCell align="right">
                                            {sample.stdev != null ? sample.stdev.toFixed(3) : '—'}
                                        </TableCell>
                                        <TableCell align="center">
                                            <Chip label={sample.n} sx={{ minWidth: 32 }} />
                                        </TableCell>
                                        <TableCell>
                                            {sample.label ?? ''}
                                        </TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell colSpan={7} sx={{ p: 0 }}>
                                            <Collapse in={isExpanded} unmountOnExit>
                                                <Box sx={{ p: 2, pl: 6, bgcolor: 'action.hover' }}>
                                                    {loadingReplicates ? (
                                                        <CircularProgress size={20} />
                                                    ) : replicates.length === 0 ? (
                                                        <Typography variant="caption" color="text.secondary">
                                                            No replicate readings found
                                                        </Typography>
                                                    ) : (
                                                        <Table size="small" sx={{ maxWidth: 400 }}>
                                                            <TableHead>
                                                                <TableRow>
                                                                    <TableCell>Replicate</TableCell>
                                                                    <TableCell align="right">Value</TableCell>
                                                                </TableRow>
                                                            </TableHead>
                                                            <TableBody>
                                                                {replicates.map((rep, i) => (
                                                                    <TableRow key={i}>
                                                                        <TableCell>
                                                                            <Typography variant="body2">
                                                                                Rep {i + 1}
                                                                            </Typography>
                                                                        </TableCell>
                                                                        <TableCell align="right">
                                                                            <Typography
                                                                                variant="body2"
                                                                                sx={{ fontFamily: tokens.font.mono }}
                                                                            >
                                                                                {rep.value.toFixed(4)}
                                                                            </Typography>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))}
                                                            </TableBody>
                                                        </Table>
                                                    )}
                                                </Box>
                                            </Collapse>
                                        </TableCell>
                                    </TableRow>
                                </React.Fragment>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};
