import { Box, Card, CardContent, Typography, IconButton, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useNotify } from 'react-admin';

export interface StationStats {
    siteName: string;
    n: number;
    nMissing: number;
    mean: number | null;
    min: number | null;
    max: number | null;
    stdDev: number | null;
}

export function computeStationStats(
    siteName: string,
    values: (number | null | undefined)[],
): StationStats {
    let sum = 0;
    let n = 0;
    let nMissing = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (const v of values) {
        if (v === null || v === undefined || Number.isNaN(v)) {
            nMissing++;
            continue;
        }
        n++;
        sum += v;
        if (min === null || v < min) min = v;
        if (max === null || v > max) max = v;
    }
    const mean = n > 0 ? sum / n : null;
    let stdDev: number | null = null;
    if (n > 1 && mean !== null) {
        let sumSq = 0;
        for (const v of values) {
            if (v === null || v === undefined || Number.isNaN(v)) continue;
            sumSq += (v - mean) ** 2;
        }
        stdDev = Math.sqrt(sumSq / (n - 1));
    }
    return { siteName, n, nMissing, mean, min, max, stdDev };
}

const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(3));

interface CompareStatsPanelProps {
    stats: StationStats[];
    units?: string | null;
    parameterName?: string;
}

export function CompareStatsPanel({ stats, units, parameterName }: CompareStatsPanelProps) {
    const notify = useNotify();

    if (stats.length === 0) return null;

    const handleCopy = async () => {
        const header = ['site', 'n', 'missing', 'mean', 'min', 'max', 'std_dev'].join(',');
        const rows = stats.map((s) =>
            [s.siteName, s.n, s.nMissing, fmt(s.mean), fmt(s.min), fmt(s.max), fmt(s.stdDev)].join(','),
        );
        const csv = [header, ...rows].join('\n');
        try {
            await navigator.clipboard.writeText(csv);
            notify('Stats copied to clipboard', { type: 'success' });
        } catch {
            notify('Failed to copy stats', { type: 'error' });
        }
    };

    return (
        <Card variant="outlined" sx={{ mt: 2 }}>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2">
                        Statistics{parameterName ? ` — ${parameterName}` : ''}
                        {units ? ` (${units})` : ''}
                    </Typography>
                    <Tooltip title="Copy as CSV">
                        <IconButton onClick={handleCopy}>
                            <ContentCopyIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box
                    component="table"
                    sx={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        '& th, & td': {
                            textAlign: 'right',
                            py: 0.75,
                            px: 1,
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: '0.8125rem',
                        },
                        '& th:first-of-type, & td:first-of-type': { textAlign: 'left' },
                        '& th': { color: 'text.secondary', fontWeight: 600 },
                    }}
                >
                    <thead>
                        <tr>
                            <th>Station</th>
                            <th>N</th>
                            <th>Missing</th>
                            <th>Mean</th>
                            <th>Min</th>
                            <th>Max</th>
                            <th>Std dev</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stats.map((s) => (
                            <tr key={s.siteName}>
                                <td>{s.siteName}</td>
                                <td>{s.n}</td>
                                <td>{s.nMissing}</td>
                                <td>{fmt(s.mean)}</td>
                                <td>{fmt(s.min)}</td>
                                <td>{fmt(s.max)}</td>
                                <td>{fmt(s.stdDev)}</td>
                            </tr>
                        ))}
                    </tbody>
                </Box>
            </CardContent>
        </Card>
    );
}
