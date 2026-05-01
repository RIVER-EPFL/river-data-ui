import { Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';

export type AlarmLevel = 'ok' | 'warning' | 'alarm' | 'unknown';

export function AlarmDot({ level, size = 20 }: { level: AlarmLevel; size?: number }) {
    switch (level) {
        case 'ok':
            return (
                <Tooltip title="OK - within thresholds">
                    <CheckCircleIcon sx={{ color: 'success.main', fontSize: size }} />
                </Tooltip>
            );
        case 'warning':
            return (
                <Tooltip title="Warning threshold exceeded">
                    <WarningAmberIcon sx={{ color: 'warning.main', fontSize: size }} />
                </Tooltip>
            );
        case 'alarm':
            return (
                <Tooltip title="Alarm threshold exceeded">
                    <ErrorIcon sx={{ color: 'error.main', fontSize: size }} />
                </Tooltip>
            );
        default:
            return (
                <Tooltip title="No thresholds configured">
                    <CheckCircleIcon sx={{ color: 'action.disabled', fontSize: size }} />
                </Tooltip>
            );
    }
}
