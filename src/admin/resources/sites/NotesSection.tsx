import React, { useState } from 'react';
import {
    useCreate,
    useDelete,
    useGetList,
    useNotify,
    useRefresh,
    useUpdate,
} from 'react-admin';
import {
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    IconButton,
    TextField,
    Typography,
} from '@mui/material';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VerifiedIcon from '@mui/icons-material/Verified';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

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

    const handleClose = () => {
        setText('');
        setVerified(false);
        onClose();
    };

    const handleSubmit = () => {
        create(
            'notes',
            { data: { site_id: siteId, text, verified } },
            {
                onSuccess: () => {
                    notify('Note added', { type: 'success' });
                    refresh();
                    handleClose();
                },
                onError: (error) => {
                    notify(
                        `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        { type: 'error' },
                    );
                },
            },
        );
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
                <Button onClick={handleClose} disabled={isPending}>
                    Cancel
                </Button>
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
                    notify(
                        `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        { type: 'error' },
                    );
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
                <Button onClick={onClose} disabled={isPending}>
                    Cancel
                </Button>
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

export const NotesSection: React.FC<{ siteId: string; defaultExpanded?: boolean }> = ({
    siteId,
    defaultExpanded = false,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [editingNote, setEditingNote] = useState<NoteRecord | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<NoteRecord | null>(null);
    const [deleteOne] = useDelete();
    const notify = useNotify();
    const refresh = useRefresh();

    const { data: notes, isPending } = useGetList<NoteRecord>(
        'notes',
        {
            filter: { site_id: siteId },
            pagination: { page: 1, perPage: 50 },
            sort: { field: 'created_at', order: 'DESC' },
        },
        { enabled: !!siteId },
    );

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
                                        <Typography
                                            variant="body2"
                                            sx={{ whiteSpace: 'pre-wrap', mb: 0.5 }}
                                        >
                                            {note.text}
                                        </Typography>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {note.verified && (
                                                <Chip
                                                    icon={<VerifiedIcon />}
                                                    label="Verified"
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
                                                    onClick={() => setEditingNote(note)}
                                                    title="Edit note"
                                                >
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton
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
                                        notify(
                                            `Failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                            { type: 'error' },
                                        );
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
