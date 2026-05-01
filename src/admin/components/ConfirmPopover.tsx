import { useState, type ReactElement } from 'react';
import { Popover, Box, Typography, Button, Stack } from '@mui/material';

interface ConfirmPopoverProps {
    /** The trigger element (a Button, IconButton, etc.). It will be cloned with onClick wired up. */
    trigger: ReactElement<{ onClick?: (e: React.MouseEvent<HTMLElement>) => void }>;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmColor?: 'primary' | 'secondary' | 'error' | 'warning';
    onConfirm: () => void | Promise<void>;
}

/**
 * Wraps any trigger element with a confirm popover. Use this for destructive or
 * irreversible actions (recalibrate, recompute, unpair, decommission) so the
 * user gets a visible "are you sure" before commit.
 */
export function ConfirmPopover({
    trigger,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    confirmColor = 'primary',
    onConfirm,
}: ConfirmPopoverProps) {
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [busy, setBusy] = useState(false);

    const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
        e.stopPropagation();
        setAnchorEl(e.currentTarget);
    };

    const handleClose = () => {
        if (busy) return;
        setAnchorEl(null);
    };

    const handleConfirm = async () => {
        setBusy(true);
        try {
            await onConfirm();
        } finally {
            setBusy(false);
            setAnchorEl(null);
        }
    };

    const wrappedTrigger = {
        ...trigger,
        props: {
            ...trigger.props,
            onClick: handleOpen,
        },
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
                <Box sx={{ p: 2, maxWidth: 320 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        {title}
                    </Typography>
                    {description && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                            {description}
                        </Typography>
                    )}
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <Button onClick={handleClose} disabled={busy} size="small">
                            {cancelLabel}
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={busy}
                            color={confirmColor}
                            variant="contained"
                            size="small"
                        >
                            {confirmLabel}
                        </Button>
                    </Stack>
                </Box>
            </Popover>
        </>
    );
}
