import { useState, useMemo, useEffect } from 'react';
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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

interface SourceSummary {
  source_system: string;
  unpaired: number;
  paired: number;
}

interface GroupedProject {
  name: string;
  count: number;
  create: boolean;
}

interface GroupedParameter {
  name: string;
  units: string;
  count: number;
  create: boolean;
  skipped: boolean;
}

interface GroupedSite {
  name: string;
  glacier: string | null;
  lat: number | null;
  lon: number | null;
  count: number;
  create: boolean;
  skipped: boolean;
}

interface GroupedWarning {
  warning: string;
  parameter: string;
  count: number;
}

interface PairingWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export const PairingWizard = ({ open, onClose, onComplete }: PairingWizardProps) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();

  const [activeStep, setActiveStep] = useState(0);
  const [sourceSystem, setSourceSystem] = useState('');
  const [sourceSummaries, setSourceSummaries] = useState<SourceSummary[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [plan, setPlan] = useState<PairingPlan | null>(null);
  const [localEntries, setLocalEntries] = useState<PairingPlanEntry[]>([]);
  const [result, setResult] = useState<PairingPlanApplyResult | null>(null);

  // Site pagination
  const [sitePage, setSitePage] = useState(0);
  const [siteRowsPerPage, setSiteRowsPerPage] = useState(25);

  // Pending action changes to batch-send
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, PlanEntryUpdate>>(new Map());

  // --------------------------------------------------------------------------
  // Load source summaries when dialog opens
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (open) {
      setLoadingSources(true);
      dataProvider
        .getUnpairedSummary()
        .then((res) => {
          const withUnpaired = res.data.filter((s) => s.unpaired > 0);
          setSourceSummaries(withUnpaired);
          if (withUnpaired.length === 1) {
            setSourceSystem(withUnpaired[0].source_system);
          }
        })
        .catch(() => {
          notify('Failed to load source summaries', { type: 'error' });
        })
        .finally(() => setLoadingSources(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --------------------------------------------------------------------------
  // Grouped data (computed from localEntries)
  // --------------------------------------------------------------------------

  const groupedProjects = useMemo(() => {
    const map = new Map<string, GroupedProject>();
    for (const e of localEntries.filter((e) => e.action === 'pair')) {
      const key = e.project.name;
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { name: key, count: 1, create: e.project.create });
      }
    }
    return Array.from(map.values());
  }, [localEntries]);

  const groupedParameters = useMemo(() => {
    const map = new Map<string, GroupedParameter>();
    for (const e of localEntries) {
      const key = e.parameter.name;
      const existing = map.get(key);
      if (existing) {
        if (e.action === 'pair') existing.count++;
        // If any entry for this param is not skipped, the param is not fully skipped
        if (e.action !== 'skip') existing.skipped = false;
      } else {
        map.set(key, {
          name: key,
          units: e.parameter.units,
          count: e.action === 'pair' ? 1 : 0,
          create: e.parameter.create,
          skipped: e.action === 'skip',
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [localEntries]);

  const groupedSites = useMemo(() => {
    const map = new Map<string, GroupedSite>();
    for (const e of localEntries) {
      const key = e.site.name;
      const existing = map.get(key);
      if (existing) {
        if (e.action === 'pair') existing.count++;
        if (e.action !== 'skip') existing.skipped = false;
      } else {
        // Try to extract glacier from source_name prefix or metadata
        let glacier: string | null = null;
        if (e.source_name) {
          const parts = e.source_name.split('/');
          if (parts.length > 1) glacier = parts[0];
        }
        map.set(key, {
          name: key,
          glacier,
          lat: e.site.latitude,
          lon: e.site.longitude,
          count: e.action === 'pair' ? 1 : 0,
          create: e.site.create,
          skipped: e.action === 'skip',
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [localEntries]);

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

  const groupedWarnings = useMemo(() => {
    const map = new Map<string, GroupedWarning>();
    for (const e of localEntries) {
      for (const w of e.warnings) {
        const key = `${w}||${e.parameter.name}`;
        const existing = map.get(key);
        if (existing) {
          existing.count++;
        } else {
          map.set(key, { warning: w, parameter: e.parameter.name, count: 1 });
        }
      }
    }
    return Array.from(map.values());
  }, [localEntries]);

  const hasWarnings = groupedWarnings.length > 0;

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  const handleCreatePlan = async () => {
    if (!sourceSystem) return;
    setLoading(true);
    try {
      const res = await dataProvider.createPairingPlan(sourceSystem);
      setPlan(res.data);
      setLocalEntries(res.data.entries);
      setPendingUpdates(new Map());
      setActiveStep(1);
      setSitePage(0);
    } catch {
      notify('Failed to create pairing plan', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const toggleParameterSkip = (paramName: string) => {
    // Determine current state: if all entries with this param are skipped, toggle to pair; otherwise skip all
    const paramEntries = localEntries.filter((e) => e.parameter.name === paramName);
    const allSkipped = paramEntries.every((e) => e.action === 'skip');
    const newAction = allSkipped ? 'pair' : 'skip';

    const updates = new Map(pendingUpdates);
    setLocalEntries((prev) =>
      prev.map((e) => {
        if (e.parameter.name === paramName) {
          const existing = updates.get(e.stream_id) ?? { stream_id: e.stream_id };
          updates.set(e.stream_id, { ...existing, action: newAction });
          return { ...e, action: newAction };
        }
        return e;
      }),
    );
    setPendingUpdates(updates);
  };

  const toggleSiteSkip = (siteName: string) => {
    const siteEntries = localEntries.filter((e) => e.site.name === siteName);
    const allSkipped = siteEntries.every((e) => e.action === 'skip');
    const newAction = allSkipped ? 'pair' : 'skip';

    const updates = new Map(pendingUpdates);
    setLocalEntries((prev) =>
      prev.map((e) => {
        if (e.site.name === siteName) {
          const existing = updates.get(e.stream_id) ?? { stream_id: e.stream_id };
          updates.set(e.stream_id, { ...existing, action: newAction });
          return { ...e, action: newAction };
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
    setSitePage(0);
    setSourceSystem('');
    setSourceSummaries([]);
    onClose();
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
      ) : loadingSources ? (
        <>
          <CircularProgress />
          <Typography sx={{ mt: 2 }}>Loading source systems...</Typography>
        </>
      ) : sourceSummaries.length === 0 ? (
        <Typography color="text.secondary">No source systems with unpaired streams found.</Typography>
      ) : (
        <>
          <Typography sx={{ mb: 3 }}>
            Create a pairing plan to map unpaired streams to projects, sites, and parameters.
          </Typography>
          <FormControl sx={{ mb: 3, width: 360 }} size="small">
            <InputLabel>Source System</InputLabel>
            <Select
              value={sourceSystem}
              label="Source System"
              onChange={(e) => setSourceSystem(e.target.value)}
            >
              {sourceSummaries.map((s) => (
                <MenuItem key={s.source_system} value={s.source_system}>
                  {s.source_system} ({s.unpaired.toLocaleString()} unpaired)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box>
            <Button
              variant="contained"
              onClick={handleCreatePlan}
              disabled={!sourceSystem}
              startIcon={<AutoFixHighIcon />}
            >
              Create Plan
            </Button>
          </Box>
        </>
      )}
    </Box>
  );

  const renderReviewMapping = () => {
    const paginatedSites = groupedSites.slice(
      sitePage * siteRowsPerPage,
      (sitePage + 1) * siteRowsPerPage,
    );

    return (
      <Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          {localSummary.total.toLocaleString()} streams
          {' -> '}{localSummary.projects} project(s), {localSummary.sites} sites, {localSummary.parameters} parameters.
          {' '}{localSummary.willPair.toLocaleString()} will pair, {localSummary.willSkip.toLocaleString()} will skip.
        </Alert>

        {/* Projects */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">
              Projects ({groupedProjects.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Streams</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupedProjects.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell align="right">{p.count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={p.create ? 'Will Create' : 'Exists'}
                          color={p.create ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {groupedProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} align="center">
                        <Typography color="text.secondary" variant="body2">
                          No projects (all streams skipped)
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>

        {/* Parameters */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">
              Parameters ({groupedParameters.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TableContainer sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Units</TableCell>
                    <TableCell align="right">Streams</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupedParameters.map((p) => (
                    <TableRow key={p.name} sx={p.skipped ? { opacity: 0.5 } : undefined}>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>{p.units}</TableCell>
                      <TableCell align="right">{p.count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={p.create ? 'Will Create' : 'Exists'}
                          color={p.create ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <ToggleButtonGroup
                          size="small"
                          value={p.skipped ? 'skip' : 'pair'}
                          exclusive
                          onChange={() => toggleParameterSkip(p.name)}
                        >
                          <ToggleButton value="pair" sx={{ py: 0.25, px: 1 }}>Pair</ToggleButton>
                          <ToggleButton value="skip" sx={{ py: 0.25, px: 1 }}>Skip</ToggleButton>
                        </ToggleButtonGroup>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </AccordionDetails>
        </Accordion>

        {/* Sites */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1">
              Sites ({groupedSites.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Glacier</TableCell>
                    <TableCell>Coordinates</TableCell>
                    <TableCell align="right">Streams</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedSites.map((s) => (
                    <TableRow key={s.name} sx={s.skipped ? { opacity: 0.5 } : undefined}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.glacier ?? '-'}</TableCell>
                      <TableCell>
                        {s.lat != null && s.lon != null
                          ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}`
                          : '-'}
                      </TableCell>
                      <TableCell align="right">{s.count.toLocaleString()}</TableCell>
                      <TableCell>
                        <Chip
                          label={s.create ? 'Will Create' : 'Exists'}
                          color={s.create ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <ToggleButtonGroup
                          size="small"
                          value={s.skipped ? 'skip' : 'pair'}
                          exclusive
                          onChange={() => toggleSiteSkip(s.name)}
                        >
                          <ToggleButton value="pair" sx={{ py: 0.25, px: 1 }}>Pair</ToggleButton>
                          <ToggleButton value="skip" sx={{ py: 0.25, px: 1 }}>Skip</ToggleButton>
                        </ToggleButtonGroup>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paginatedSites.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center">
                        <Typography color="text.secondary" variant="body2">
                          No sites
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={groupedSites.length}
              page={sitePage}
              onPageChange={(_, p) => setSitePage(p)}
              rowsPerPage={siteRowsPerPage}
              onRowsPerPageChange={(e) => {
                setSiteRowsPerPage(parseInt(e.target.value, 10));
                setSitePage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </AccordionDetails>
        </Accordion>
      </Box>
    );
  };

  const renderWarnings = () => (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {groupedWarnings.length} distinct warning(s) across streams. Review them before applying.
      </Alert>
      <TableContainer sx={{ maxHeight: 400 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Warning</TableCell>
              <TableCell>Parameter</TableCell>
              <TableCell align="right">Affected Streams</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {groupedWarnings.map((gw, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Warning">
                      <WarningAmberIcon fontSize="small" sx={{ color: 'warning.main', flexShrink: 0 }} />
                    </Tooltip>
                    <Typography variant="body2" color="warning.main">
                      {gw.warning}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>{gw.parameter}</TableCell>
                <TableCell align="right">{gw.count.toLocaleString()}</TableCell>
              </TableRow>
            ))}
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
