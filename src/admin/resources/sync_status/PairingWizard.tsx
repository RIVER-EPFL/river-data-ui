import { useState, useMemo } from 'react';
import { useNotify } from 'react-admin';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  LinearProgress,
  TablePagination,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Card,
  CardContent,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type {
  PairingPlan,
  PairingPlanEntry,
  PairingPlanApplyResult,
  PlanEntryUpdate,
} from '../../dataProvider';

const STEPS = ['Select Source', 'Review Mapping', 'Warnings', 'Apply', 'Result'];

type FilterMode = 'all' | 'needs_review' | 'ready' | 'skipped';

interface PairingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export const PairingWizard = ({ open, onClose, onComplete }: PairingWizardProps) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();

  const [activeStep, setActiveStep] = useState(0);
  const [sourceSystem, setSourceSystem] = useState('nomis');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<PairingPlan | null>(null);
  const [localEntries, setLocalEntries] = useState<PairingPlanEntry[]>([]);
  const [result, setResult] = useState<PairingPlanApplyResult | null>(null);

  // Pagination
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Filters
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Pending action changes to batch-send
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, PlanEntryUpdate>>(new Map());

  // --------------------------------------------------------------------------
  // Derived data
  // --------------------------------------------------------------------------

  const filteredEntries = useMemo(() => {
    let entries = localEntries;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(
        (e) =>
          (e.source_name ?? '').toLowerCase().includes(q) ||
          e.source_key.toLowerCase().includes(q),
      );
    }

    if (filterMode === 'needs_review') {
      entries = entries.filter((e) => e.confidence !== 'exact' && e.action === 'pair');
    } else if (filterMode === 'ready') {
      entries = entries.filter((e) => e.confidence === 'exact' && e.action === 'pair');
    } else if (filterMode === 'skipped') {
      entries = entries.filter((e) => e.action === 'skip');
    }

    return entries;
  }, [localEntries, filterMode, searchQuery]);

  const paginatedEntries = useMemo(
    () => filteredEntries.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
    [filteredEntries, page, rowsPerPage],
  );

  const localSummary = useMemo(() => {
    const willPair = localEntries.filter((e) => e.action === 'pair').length;
    const willSkip = localEntries.filter((e) => e.action === 'skip').length;
    const projectNames = new Set(localEntries.filter((e) => e.action === 'pair').map((e) => e.project.name));
    const siteNames = new Set(localEntries.filter((e) => e.action === 'pair').map((e) => e.site.name));
    const paramNames = new Set(localEntries.filter((e) => e.action === 'pair').map((e) => e.parameter.name));
    const sitesToCreate = new Set(
      localEntries.filter((e) => e.action === 'pair' && e.site.create).map((e) => e.site.name),
    ).size;
    const paramsToCreate = new Set(
      localEntries.filter((e) => e.action === 'pair' && e.parameter.create).map((e) => e.parameter.name),
    ).size;

    return {
      total: localEntries.length,
      willPair,
      willSkip,
      projects: projectNames.size,
      sites: siteNames.size,
      parameters: paramNames.size,
      sitesToCreate,
      paramsToCreate,
    };
  }, [localEntries]);

  const entriesWithWarnings = useMemo(
    () => localEntries.filter((e) => e.warnings.length > 0),
    [localEntries],
  );

  const hasWarnings = entriesWithWarnings.length > 0;

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleCreatePlan = async () => {
    setLoading(true);
    try {
      const res = await dataProvider.createPairingPlan(sourceSystem);
      setPlan(res.data);
      setLocalEntries(res.data.entries);
      setPendingUpdates(new Map());
      setActiveStep(1);
      setPage(0);
      setFilterMode('all');
      setSearchQuery('');
    } catch {
      notify('Failed to create pairing plan', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleActionChange = (streamId: string, newAction: string) => {
    setLocalEntries((prev) =>
      prev.map((e) => (e.stream_id === streamId ? { ...e, action: newAction } : e)),
    );
    setPendingUpdates((prev) => {
      const next = new Map(prev);
      const existing = next.get(streamId) ?? { stream_id: streamId };
      next.set(streamId, { ...existing, action: newAction });
      return next;
    });
  };

  const handleBulkAcceptExact = () => {
    const updates = new Map(pendingUpdates);
    setLocalEntries((prev) =>
      prev.map((e) => {
        if (e.confidence === 'exact' && e.action !== 'pair') {
          const existing = updates.get(e.stream_id) ?? { stream_id: e.stream_id };
          updates.set(e.stream_id, { ...existing, action: 'pair' });
          return { ...e, action: 'pair' };
        }
        return e;
      }),
    );
    setPendingUpdates(updates);
  };

  const handleBulkSkipUnknowns = () => {
    const updates = new Map(pendingUpdates);
    setLocalEntries((prev) =>
      prev.map((e) => {
        if (e.confidence === 'none' && e.action !== 'skip') {
          const existing = updates.get(e.stream_id) ?? { stream_id: e.stream_id };
          updates.set(e.stream_id, { ...existing, action: 'skip' });
          return { ...e, action: 'skip' };
        }
        return e;
      }),
    );
    setPendingUpdates(updates);
  };

  const flushPendingUpdates = async () => {
    if (!plan || pendingUpdates.size === 0) return;
    const updates = Array.from(pendingUpdates.values());
    try {
      const res = await dataProvider.updatePairingPlan(plan.id, updates);
      setPlan(res.data);
      setLocalEntries(res.data.entries);
      setPendingUpdates(new Map());
    } catch {
      notify('Failed to save plan updates', { type: 'error' });
      throw new Error('update failed');
    }
  };

  const handleNextFromReview = async () => {
    try {
      await flushPendingUpdates();
      if (hasWarnings) {
        setActiveStep(2);
      } else {
        setActiveStep(3);
      }
    } catch {
      // Error already notified in flushPendingUpdates
    }
  };

  const handleContinueFromWarnings = () => {
    setActiveStep(3);
  };

  const handleApply = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      const res = await dataProvider.applyPairingPlan(plan.id);
      setResult(res.data);
      setActiveStep(4);
      onComplete();
    } catch {
      notify('Failed to apply pairing plan', { type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const handleRevert = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      await dataProvider.revertPairingPlan(plan.id);
      notify('Pairing plan reverted', { type: 'success' });
      handleClose();
    } catch {
      notify('Failed to revert pairing plan', { type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setPlan(null);
    setLocalEntries([]);
    setResult(null);
    setPendingUpdates(new Map());
    setPage(0);
    setFilterMode('all');
    setSearchQuery('');
    setSourceSystem('nomis');
    onClose();
  };

  // --------------------------------------------------------------------------
  // Render helpers
  // --------------------------------------------------------------------------

  const confidenceChip = (confidence: string) => {
    const color = confidence === 'exact' ? 'success' : confidence === 'none' ? 'error' : 'warning';
    return <Chip label={confidence} color={color} size="small" variant="outlined" />;
  };

  // --------------------------------------------------------------------------
  // Steps
  // --------------------------------------------------------------------------

  const renderSelectSource = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      {loading ? (
        <>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Creating pairing plan...</Typography>
        </>
      ) : (
        <>
          <Typography sx={{ mb: 3 }}>
            Create a pairing plan to map unpaired streams to projects, sites, and parameters.
          </Typography>
          <TextField
            label="Source System"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            size="small"
            sx={{ mb: 3, width: 300 }}
          />
          <Box>
            <Button
              variant="contained"
              onClick={handleCreatePlan}
              startIcon={<AutoFixHighIcon />}
            >
              Create Plan
            </Button>
          </Box>
        </>
      )}
    </Box>
  );

  const renderReviewMapping = () => (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        {localSummary.total.toLocaleString()} streams{' '}
        &rarr; {localSummary.projects} project(s), {localSummary.sites} sites, {localSummary.parameters} parameters.
        {localSummary.sitesToCreate > 0 && ` ${localSummary.sitesToCreate} sites to create.`}
        {localSummary.paramsToCreate > 0 && ` ${localSummary.paramsToCreate} parameters to create.`}
        {` ${localSummary.willPair.toLocaleString()} will pair, ${localSummary.willSkip.toLocaleString()} will skip.`}
      </Alert>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            size="small"
            value={filterMode}
            exclusive
            onChange={(_, v) => { if (v) { setFilterMode(v); setPage(0); } }}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="needs_review">Needs Review</ToggleButton>
            <ToggleButton value="ready">Ready</ToggleButton>
            <ToggleButton value="skipped">Skipped</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            placeholder="Search by stream name..."
            size="small"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            sx={{ width: 250 }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={handleBulkAcceptExact}>
            Accept all exact
          </Button>
          <Button size="small" variant="outlined" color="warning" onClick={handleBulkSkipUnknowns}>
            Skip all unknowns
          </Button>
        </Box>
      </Box>

      {/* Table */}
      <TableContainer sx={{ maxHeight: 500 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Stream Name</TableCell>
              <TableCell>Project</TableCell>
              <TableCell>Site</TableCell>
              <TableCell>Parameter</TableCell>
              <TableCell>Units</TableCell>
              <TableCell>Confidence</TableCell>
              <TableCell>Action</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedEntries.map((entry) => (
              <TableRow key={entry.stream_id} hover>
                <TableCell>
                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                    {entry.source_name ?? entry.source_key}
                  </Typography>
                </TableCell>
                <TableCell>{entry.project.name}</TableCell>
                <TableCell>{entry.site.name}</TableCell>
                <TableCell>{entry.parameter.name}</TableCell>
                <TableCell>{entry.parameter.units}</TableCell>
                <TableCell>{confidenceChip(entry.confidence)}</TableCell>
                <TableCell>
                  <ToggleButtonGroup
                    size="small"
                    value={entry.action}
                    exclusive
                    onChange={(_, v) => { if (v) handleActionChange(entry.stream_id, v); }}
                  >
                    <ToggleButton value="pair" sx={{ py: 0.25, px: 1 }}>Pair</ToggleButton>
                    <ToggleButton value="skip" sx={{ py: 0.25, px: 1 }}>Skip</ToggleButton>
                  </ToggleButtonGroup>
                </TableCell>
                <TableCell>
                  {entry.warnings.length > 0 && (
                    <Tooltip title={entry.warnings.join('; ')}>
                      <WarningAmberIcon fontSize="small" sx={{ color: 'orange' }} />
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {paginatedEntries.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No entries match the current filter
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={filteredEntries.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50, 100]}
      />
    </Box>
  );

  const renderWarnings = () => (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {entriesWithWarnings.length} entries have warnings. Review them before applying.
      </Alert>
      <TableContainer sx={{ maxHeight: 400 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Stream</TableCell>
              <TableCell>Parameter</TableCell>
              <TableCell>Warning</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entriesWithWarnings.map((entry) =>
              entry.warnings.map((warning, idx) => (
                <TableRow key={`${entry.stream_id}-${idx}`}>
                  <TableCell>{entry.source_name ?? entry.source_key}</TableCell>
                  <TableCell>{entry.parameter.name}</TableCell>
                  <TableCell>
                    <Typography variant="body2" color="warning.main">
                      {warning}
                    </Typography>
                  </TableCell>
                </TableRow>
              )),
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );

  const renderApply = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      {applying ? (
        <>
          <LinearProgress sx={{ mb: 2 }} />
          <Typography>Applying pairing plan...</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This may take a moment for large datasets
          </Typography>
        </>
      ) : (
        <>
          <Typography variant="h6" sx={{ mb: 2 }}>Ready to apply</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, maxWidth: 400, mx: 'auto', textAlign: 'left', mb: 3 }}>
            <Typography variant="body2">Streams to pair:</Typography>
            <Typography variant="body2"><strong>{localSummary.willPair.toLocaleString()}</strong></Typography>
            <Typography variant="body2">Streams to skip:</Typography>
            <Typography variant="body2"><strong>{localSummary.willSkip.toLocaleString()}</strong></Typography>
            <Typography variant="body2">Sites to create:</Typography>
            <Typography variant="body2"><strong>{localSummary.sitesToCreate}</strong></Typography>
            <Typography variant="body2">Parameters to create:</Typography>
            <Typography variant="body2"><strong>{localSummary.paramsToCreate}</strong></Typography>
          </Box>
          <Button variant="contained" onClick={handleApply} size="large">
            Apply Plan
          </Button>
        </>
      )}
    </Box>
  );

  const renderResult = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Pairing Complete</Typography>
          {result && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1 }}>
              <Typography variant="body2">Projects created:</Typography>
              <Typography variant="body2"><strong>{result.projects_created}</strong></Typography>
              <Typography variant="body2">Sites created:</Typography>
              <Typography variant="body2"><strong>{result.sites_created}</strong></Typography>
              <Typography variant="body2">Parameters created:</Typography>
              <Typography variant="body2"><strong>{result.parameters_created}</strong></Typography>
              <Typography variant="body2">Site parameters created:</Typography>
              <Typography variant="body2"><strong>{result.site_parameters_created}</strong></Typography>
              <Typography variant="body2">Streams paired:</Typography>
              <Typography variant="body2"><strong>{result.streams_paired}</strong></Typography>
              <Typography variant="body2">Readings backfilled:</Typography>
              <Typography variant="body2"><strong>{result.readings_backfilled}</strong></Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );

  // Determine which steps to show in stepper (skip warnings if none)
  const visibleSteps = hasWarnings
    ? STEPS
    : STEPS.filter((s) => s !== 'Warnings');

  const visibleStepIndex = () => {
    if (!hasWarnings && activeStep >= 2) {
      return activeStep - 1;
    }
    return activeStep;
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xl" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoFixHighIcon color="primary" />
        Pairing Plan{plan ? ` - ${plan.source_system}` : ''}
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={visibleStepIndex()} sx={{ mb: 3 }}>
          {visibleSteps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {activeStep === 0 && renderSelectSource()}
        {activeStep === 1 && plan && renderReviewMapping()}
        {activeStep === 2 && renderWarnings()}
        {activeStep === 3 && renderApply()}
        {activeStep === 4 && renderResult()}
      </DialogContent>
      <DialogActions>
        {activeStep === 4 && (
          <Button
            color="warning"
            onClick={handleRevert}
            disabled={applying}
          >
            Revert All
          </Button>
        )}
        <Button onClick={handleClose}>
          {activeStep === 4 ? 'Done' : 'Cancel'}
        </Button>
        {activeStep === 1 && (
          <Button variant="contained" onClick={handleNextFromReview}>
            Next
          </Button>
        )}
        {activeStep === 2 && (
          <Button variant="contained" onClick={handleContinueFromWarnings}>
            Continue
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
