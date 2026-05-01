import { useState, type ReactElement } from 'react';
import {
    Popover,
    Box,
    Typography,
    Button,
    Stack,
    TextField,
    CircularProgress,
} from '@mui/material';
import { useUpdate, useNotify, useRefresh } from 'react-admin';

interface RecallPopoverProps {
    /** Trigger element (Button, IconButton, etc.). Cloned with onClick wired. */
    trigger: ReactElement<{ onClick?: (e: React.MouseEvent<HTMLElement>) => void }>;
    /** The currently active deployment to recall. */
    deploymentId: string;
    /** Sensor serial for display. */
    sensorSerial?: string;
    /** Site name for display. */
    siteName?: string;
    /** Existing notes on the deployment, to append to. */
    existingNotes?: string | null;
    /** Optional callback after a successful recall. */
    onRecalled?: () => void;
}

/**
 * Compact "Recall this sensor?" popover for ending an active deployment without
 * redeploying. Used as the row-level affordance on the Sensors list, the
 * SensorCard, and the "Remove from site" link on the Move page.
 */
export function RecallPopover({
    trigger,
    deploymentId,
    sensorSerial,
    siteName,
    existingNotes,
    onRecalled,
}: RecallPopoverProps) {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [endTime, setEndTime] = useState(new Date().toISOString().slice(0, 16));
    const [notes, setNotes] = useState('');
    const [update, { isPending }] = useUpdate();
    const notify = useNotify();
    const refresh = useRefresh();

    const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        setAnchorEl(e.currentTarget);
    };

    const handleClose = () => {
        if (isPending) return;
        setAnchorEl(null);
    };

    const handleConfirm = () => {
        update(
            'sensor_deployments',
            {
                id: deploymentId,
                data: {
                    deployed_until: new Date(endTime).toISOString(),
                    notes: notes
                        ? `${existingNotes ? existingNotes + '; ' : ''}${notes}`
                        : existingNotes ?? null,
                },
                previousData: { id: deploymentId },
            },
            {
                onSuccess: () => {
                    notify('Sensor recalled', { type: 'success' });
                    refresh();
                    setAnchorEl(null);
                    onRecalled?.();
                },
                onError: () => {
                    notify('Failed to recall sensor', { type: 'error' });
                },
            },
        );
    };

    const wrappedTrigger = {
        ...trigger,
        props: { ...trigger.props, onClick: handleOpen },
    } as ReactElement;

    return (
        <>
            {wrappedTrigger}
            <Popover
                open={Boolean(anchorEl)}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <Box sx={{ p: 2, minWidth: 320 }}>
                    <Typography variant="subtitle2">
                        Recall {sensorSerial ?? 'sensor'}
                        {siteName ? ` from ${siteName}` : ''}?
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                        Ends the current deployment. Readings remain in the database
                        but the sensor will no longer be associated with the site
                        after this time.
                    </Typography>
                    <Stack spacing={1.5}>
                        <TextField
                            label="Effective from"
                            type="datetime-local"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            fullWidth
                            slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                            label="Notes (optional)"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            multiline
                            rows={2}
                            fullWidth
                            placeholder="Reason for recall..."
                        />
                    </Stack>
                    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
                        <Button onClick={handleClose} disabled={isPending} size="small">
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={isPending}
                            color="warning"
                            variant="contained"
                            size="small"
                            startIcon={isPending ? <CircularProgress size={14} /> : undefined}
                        >
                            Recall
                        </Button>
                    </Stack>
                </Box>
            </Popover>
        </>
    );
}
