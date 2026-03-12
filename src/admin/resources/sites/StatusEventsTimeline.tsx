import React, { useEffect, useState, useCallback } from 'react';
import { useKeycloak } from '../../KeycloakContext';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Collapse,
    IconButton,
    ToggleButton,
    ToggleButtonGroup,
    CircularProgress,
    Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusEvent {
    parameter_id: string;
    time: string;
    value: string;
    sensor_id?: string;
}

interface StatusEventsApiResponse {
    site: { id: string; name: string };
    events: StatusEvent[];
}

interface StatusEventsTimelineProps {
    siteId: string;
    /** Map of parameter UUID -> display name */
    parameterNames: Map<string, string>;
}

type TimeRange = '24h' | '7d' | '30d';

const TIME_RANGE_MS: Record<TimeRange, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Status value -> color chip mapping
// ---------------------------------------------------------------------------

function statusColor(value: string): 'success' | 'error' | 'warning' | 'default' {
    const v = value.toLowerCase();
    if (v === 'ok' || v === 'normal' || v === 'online') return 'success';
    if (v === 'unreachable' || v === 'offline' || v === 'error') return 'error';
    if (v === 'warning' || v === 'degraded') return 'warning';
    return 'default';
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const StatusEventsTimeline: React.FC<StatusEventsTimelineProps> = ({
    siteId,
    parameterNames,
}) => {
    const keycloak = useKeycloak();
    const [events, setEvents] = useState<StatusEvent[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [timeRange, setTimeRange] = useState<TimeRange>('7d');

    const fetchEvents = useCallback(async () => {
        if (!expanded) return;
        setLoading(true);
        setError(null);

        const now = new Date();
        const start = new Date(now.getTime() - TIME_RANGE_MS[timeRange]);
        const url = `/api/service/sites/${siteId}/status_events?start=${start.toISOString()}&format=json`;
        const headers: HeadersInit = keycloak?.token
            ? { Authorization: 'Bearer ' + keycloak.token }
            : {};

        try {
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: StatusEventsApiResponse = await res.json();
            setEvents(data.events ?? []);
        } catch (err) {
            console.error('Failed to fetch status events:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, [siteId, expanded, timeRange, keycloak]);

    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

    // Deduplicate consecutive identical statuses per parameter to show only changes
    const changes = events.reduce<StatusEvent[]>((acc, evt) => {
        let prev: StatusEvent | undefined;
        for (let i = acc.length - 1; i >= 0; i--) {
            if (acc[i].parameter_id === evt.parameter_id) {
                prev = acc[i];
                break;
            }
        }
        if (!prev || prev.value !== evt.value) {
            acc.push(evt);
        }
        return acc;
    }, []);

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
                <Typography variant="h6">Device Status</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {expanded && (
                        <ToggleButtonGroup
                            value={timeRange}
                            exclusive
                            onChange={(_, v) => {
                                if (v) setTimeRange(v);
                            }}
                            size="small"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ToggleButton value="24h">24h</ToggleButton>
                            <ToggleButton value="7d">7d</ToggleButton>
                            <ToggleButton value="30d">30d</ToggleButton>
                        </ToggleButtonGroup>
                    )}
                    <IconButton size="small">
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                </Box>
            </Box>

            <Collapse in={expanded}>
                <Card variant="outlined">
                    <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                        {loading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                                <CircularProgress size={24} />
                            </Box>
                        )}

                        {error && (
                            <Alert severity="error" sx={{ m: 1 }}>
                                Failed to load status events: {error}
                            </Alert>
                        )}

                        {!loading && !error && changes.length === 0 && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ p: 2, textAlign: 'center' }}
                            >
                                No status events recorded in this time range.
                            </Typography>
                        )}

                        {!loading && changes.length > 0 && (
                            <TableContainer sx={{ maxHeight: 400 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Time</TableCell>
                                            <TableCell>Parameter</TableCell>
                                            <TableCell>Status</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {changes.map((evt, i) => (
                                            <TableRow key={i}>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                                    {formatTime(evt.time)}
                                                </TableCell>
                                                <TableCell>
                                                    {parameterNames.get(evt.parameter_id) ??
                                                        evt.parameter_id.slice(0, 8)}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={evt.value}
                                                        size="small"
                                                        color={statusColor(evt.value)}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </CardContent>
                </Card>
            </Collapse>
        </Box>
    );
};
