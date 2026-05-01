import { Tooltip, Box } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import { tokens } from '../../theme';

export type SensorStatus = 'healthy' | 'attention' | 'undeployed' | 'critical' | 'unknown';

interface SensorStatusPinProps {
    status: SensorStatus;
    label?: string;
}

const STATUS_META: Record<SensorStatus, { color: string; defaultLabel: string }> = {
    healthy: { color: tokens.severity.ok.main, defaultLabel: 'Deployed and healthy' },
    attention: { color: tokens.severity.warning.main, defaultLabel: 'Needs attention' },
    undeployed: { color: tokens.severity.unknown.main, defaultLabel: 'Undeployed' },
    critical: { color: tokens.severity.alarm.main, defaultLabel: 'Deployed but no recent data' },
    unknown: { color: tokens.severity.unknown.main, defaultLabel: 'Status unknown' },
};

export function SensorStatusPin({ status, label }: SensorStatusPinProps) {
    const meta = STATUS_META[status];
    return (
        <Tooltip title={label ?? meta.defaultLabel}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                <CircleIcon sx={{ color: meta.color, fontSize: 14 }} />
            </Box>
        </Tooltip>
    );
}
