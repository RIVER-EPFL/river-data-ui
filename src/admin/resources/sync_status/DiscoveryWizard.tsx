import { useState } from 'react';
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
  TextField,
  Checkbox,
  LinearProgress,
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { DiscoveryItem, ApplyAction, ApplyDiscoveryResponse } from '../../dataProvider';

const steps = ['Analyze', 'Review', 'Apply'];

const confidenceColor = (confidence: string): 'success' | 'warning' | 'error' => {
  switch (confidence) {
    case 'exact': return 'success';
    case 'fuzzy': return 'warning';
    default: return 'error';
  }
};

interface ReviewRow {
  item: DiscoveryItem;
  selected: boolean;
  projectName: string;
  siteName: string;
  paramName: string;
  paramUnits: string;
}

export const DiscoveryWizard = ({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();

  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [result, setResult] = useState<ApplyDiscoveryResponse | null>(null);
  const [applying, setApplying] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const res = await dataProvider.getDiscovery();
      setItems(res.data);
      // Build review rows
      const reviewRows: ReviewRow[] = res.data.map((item) => ({
        item,
        selected: true,
        projectName:
          item.suggestions.project.match?.name ??
          item.suggestions.project.suggested_name ??
          '',
        siteName:
          item.suggestions.site.match?.name ??
          item.suggestions.site.suggested_name ??
          '',
        paramName:
          item.suggestions.parameter.match?.name ??
          item.suggestions.parameter.suggested_name ??
          '',
        paramUnits:
          item.suggestions.parameter.suggested_units ?? '',
      }));
      setRows(reviewRows);
      setActiveStep(1);
    } catch {
      notify('Failed to analyze streams', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const selectedRows = rows.filter((r) => r.selected);
    if (selectedRows.length === 0) {
      notify('No streams selected', { type: 'warning' });
      return;
    }

    setApplying(true);
    setActiveStep(2);

    const actions: ApplyAction[] = selectedRows.map((row) => {
      const { item } = row;
      const projectMatch = item.suggestions.project.match;
      const siteMatch = item.suggestions.site.match;
      const paramMatch = item.suggestions.parameter.match;
      const spMatch = item.suggestions.site_parameter.match;

      const action: ApplyAction = {
        stream_id: item.stream.id,
        pair_to: spMatch ? spMatch.id : 'new',
        use_project_id: projectMatch?.id ?? undefined,
        use_site_id: siteMatch?.id ?? undefined,
        use_parameter_id: paramMatch?.id ?? undefined,
      };

      if (!projectMatch && row.projectName) {
        action.create_project = { name: row.projectName };
      }
      if (!siteMatch && row.siteName) {
        action.create_site = { name: row.siteName };
      }
      if (!paramMatch && row.paramName) {
        action.create_parameter = {
          name: row.paramName,
          display_name: row.paramName,
          default_units: row.paramUnits,
          category: 'measurement',
        };
      }
      if (!spMatch) {
        const metadata = item.stream.metadata as Record<string, unknown>;
        action.create_site_parameter = {
          display_units: row.paramUnits || undefined,
          sample_interval_sec: typeof metadata.sample_interval_sec === 'number'
            ? metadata.sample_interval_sec
            : undefined,
          channel_id: typeof metadata.channel_id === 'number'
            ? metadata.channel_id
            : undefined,
        };
      }

      return action;
    });

    try {
      const res = await dataProvider.applyDiscovery(actions);
      setResult(res.data);
      if (res.data.errors.length === 0) {
        notify('Discovery applied successfully', { type: 'success' });
      } else {
        notify(`Applied with ${res.data.errors.length} error(s)`, { type: 'warning' });
      }
    } catch {
      notify('Failed to apply discovery', { type: 'error' });
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    if (result) {
      onComplete();
    }
    setActiveStep(0);
    setItems([]);
    setRows([]);
    setResult(null);
    onClose();
  };

  const updateRow = (index: number, updates: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...updates } : r)));
  };

  const toggleAll = (checked: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })));
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoFixHighIcon color="primary" />
        Auto-Discover & Pair Streams
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Step 0: Analyze */}
        {activeStep === 0 && (
          <Box textAlign="center" py={4}>
            {loading ? (
              <>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography>Analyzing unpaired streams...</Typography>
              </>
            ) : (
              <>
                <Typography variant="body1" gutterBottom>
                  Scan all unpaired data streams and match them to existing projects, sites, and
                  parameters based on their source path hierarchy.
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  onClick={handleAnalyze}
                  startIcon={<AutoFixHighIcon />}
                  sx={{ mt: 2 }}
                >
                  Analyze Streams
                </Button>
              </>
            )}
          </Box>
        )}

        {/* Step 1: Review */}
        {activeStep === 1 && (
          <>
            {items.length === 0 ? (
              <Alert severity="success">All streams are already paired!</Alert>
            ) : (
              <>
                {(() => {
                  const selected = rows.filter((r) => r.selected);
                  const newProjects = new Set(
                    selected
                      .filter((r) => !r.item.suggestions.project.match && r.projectName)
                      .map((r) => r.projectName.toLowerCase()),
                  ).size;
                  const newSites = new Set(
                    selected
                      .filter((r) => !r.item.suggestions.site.match && r.siteName)
                      .map((r) => r.siteName.toLowerCase()),
                  ).size;
                  const newParams = selected.filter(
                    (r) => !r.item.suggestions.parameter.match && r.paramName,
                  ).length;
                  const newSiteParams = selected.filter(
                    (r) => !r.item.suggestions.site_parameter.match,
                  ).length;
                  const parts = [
                    newProjects > 0 ? `${newProjects} project${newProjects > 1 ? 's' : ''}` : null,
                    newSites > 0 ? `${newSites} site${newSites > 1 ? 's' : ''}` : null,
                    newParams > 0 ? `${newParams} parameter${newParams > 1 ? 's' : ''}` : null,
                    newSiteParams > 0 ? `${newSiteParams} site parameter${newSiteParams > 1 ? 's' : ''}` : null,
                  ].filter(Boolean);
                  return parts.length > 0 ? (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      <strong>{selected.length} streams</strong> selected — will create{' '}
                      {parts.join(', ')}
                    </Alert>
                  ) : null;
                })()}
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="body2" color="text.secondary">
                    {rows.filter((r) => r.selected).length} of {rows.length} streams selected
                  </Typography>
                  <Box display="flex" gap={1}>
                    <Chip
                      label="Exact match"
                      color="success"
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label="Fuzzy match"
                      color="warning"
                      size="small"
                      variant="outlined"
                    />
                    <Chip
                      label="New entity"
                      color="error"
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                </Box>
                <TableContainer sx={{ maxHeight: 500 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={rows.every((r) => r.selected)}
                            indeterminate={
                              rows.some((r) => r.selected) && !rows.every((r) => r.selected)
                            }
                            onChange={(e) => toggleAll(e.target.checked)}
                          />
                        </TableCell>
                        <TableCell>Stream Path</TableCell>
                        <TableCell>Project</TableCell>
                        <TableCell>Site</TableCell>
                        <TableCell>Parameter</TableCell>
                        <TableCell>Units</TableCell>
                        <TableCell>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow key={row.item.stream.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={row.selected}
                              onChange={(e) => updateRow(idx, { selected: e.target.checked })}
                            />
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {row.item.stream.source_path ?? row.item.stream.source_name}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={row.projectName || '?'}
                              size="small"
                              color={confidenceColor(row.item.suggestions.project.confidence)}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={row.siteName || '?'}
                              size="small"
                              color={confidenceColor(row.item.suggestions.site.confidence)}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            {row.item.suggestions.parameter.confidence === 'none' ? (
                              <TextField
                                size="small"
                                value={row.paramName}
                                onChange={(e) => updateRow(idx, { paramName: e.target.value })}
                                variant="standard"
                                sx={{ width: 120 }}
                                placeholder="Name"
                              />
                            ) : (
                              <Chip
                                label={row.paramName}
                                size="small"
                                color={confidenceColor(row.item.suggestions.parameter.confidence)}
                                variant="outlined"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={row.paramUnits}
                              onChange={(e) => updateRow(idx, { paramUnits: e.target.value })}
                              variant="standard"
                              sx={{ width: 60 }}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={
                                row.item.action === 'pair_existing'
                                  ? 'Pair'
                                  : row.item.action === 'create_and_pair'
                                    ? 'Create + Pair'
                                    : 'Manual'
                              }
                              size="small"
                              variant="outlined"
                              color={
                                row.item.action === 'pair_existing'
                                  ? 'success'
                                  : row.item.action === 'create_and_pair'
                                    ? 'primary'
                                    : 'default'
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </>
        )}

        {/* Step 2: Apply */}
        {activeStep === 2 && (
          <Box>
            {applying ? (
              <Box textAlign="center" py={4}>
                <LinearProgress sx={{ mb: 2 }} />
                <Typography>Applying discovery actions...</Typography>
              </Box>
            ) : result ? (
              <>
                <Alert severity={result.errors.length > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
                  Discovery complete!
                </Alert>
                <Box
                  display="grid"
                  gridTemplateColumns="repeat(3, 1fr)"
                  gap={2}
                  sx={{ mb: 3 }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary">Projects Created</Typography>
                    <Typography variant="h5">{result.projects_created}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Sites Created</Typography>
                    <Typography variant="h5">{result.sites_created}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Parameters Created</Typography>
                    <Typography variant="h5">{result.parameters_created}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Site Parameters Created</Typography>
                    <Typography variant="h5">{result.site_parameters_created}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Streams Paired</Typography>
                    <Typography variant="h5">{result.streams_paired}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Readings Backfilled</Typography>
                    <Typography variant="h5">{result.total_backfilled.toLocaleString()}</Typography>
                  </Box>
                </Box>
                {result.errors.length > 0 && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Errors ({result.errors.length})
                    </Typography>
                    {result.errors.map((err, i) => (
                      <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {err}
                      </Typography>
                    ))}
                  </Alert>
                )}
              </>
            ) : null}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {activeStep === 1 && items.length > 0 && (
          <>
            <Button onClick={() => setActiveStep(0)}>Back</Button>
            <Button
              variant="contained"
              onClick={handleApply}
              disabled={rows.filter((r) => r.selected).length === 0}
            >
              Apply ({rows.filter((r) => r.selected).length} streams)
            </Button>
          </>
        )}
        {(activeStep === 0 || (activeStep === 1 && items.length === 0) || activeStep === 2) && (
          <Button onClick={handleClose} variant={activeStep === 2 ? 'contained' : 'text'}>
            {activeStep === 2 ? 'Done' : 'Cancel'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
