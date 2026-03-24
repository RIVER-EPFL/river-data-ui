import { useState } from 'react';
import { useNotify, useRefresh } from 'react-admin';
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
} from '@mui/material';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type {
  GroupedDiscoveryResponse,
  GroupedSite,
  GroupedParameter,
} from '../../dataProvider';

const steps = ['Analyze', 'Review', 'Apply'];

interface Props {
  open: boolean;
  sourceSystem: string;
  onClose: () => void;
  onComplete: () => void;
}

export const GroupedDiscoveryWizard = ({ open, sourceSystem, onClose, onComplete }: Props) => {
  const dataProvider = useRiverDataProvider();
  const notify = useNotify();
  const refresh = useRefresh();

  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [discovery, setDiscovery] = useState<GroupedDiscoveryResponse | null>(null);
  const [result, setResult] = useState<{ streams_paired: number; sites_created: number; parameters_created: number } | null>(null);

  // Pagination for sites
  const [sitesPage, setSitesPage] = useState(0);
  const [sitesPerPage, setSitesPerPage] = useState(25);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const res = await dataProvider.groupedDiscovery(sourceSystem);
      setDiscovery(res.data);
      setActiveStep(1);
    } catch {
      notify('Failed to analyze streams', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!discovery) return;
    setApplying(true);
    setActiveStep(2);
    try {
      const projectName = discovery.projects[0]?.name ?? sourceSystem.toUpperCase();
      const res = await dataProvider.bulkPair({
        source_system: sourceSystem,
        project_name: projectName,
        sites: discovery.sites.map((s) => ({
          name: s.name,
          existing_id: s.existing_id,
        })),
        parameters: discovery.parameters.map((p) => ({
          name: p.name,
          display_name: p.display_name,
          units: p.units,
          existing_id: p.existing_id,
        })),
      });
      setResult({
        streams_paired: res.data.streams_paired,
        sites_created: res.data.sites_created,
        parameters_created: res.data.parameters_created,
      });
      notify(`Paired ${res.data.streams_paired} streams`, { type: 'success' });
      refresh();
      onComplete();
    } catch {
      notify('Bulk pair failed', { type: 'error' });
      setActiveStep(1);
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    setActiveStep(0);
    setDiscovery(null);
    setResult(null);
    setSitesPage(0);
    onClose();
  };

  const paginatedSites = discovery?.sites.slice(
    sitesPage * sitesPerPage,
    (sitesPage + 1) * sitesPerPage,
  ) ?? [];

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoFixHighIcon color="primary" />
        Grouped Auto-Discover & Pair ({sourceSystem})
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
          <Box sx={{ textAlign: 'center', py: 2 }}>
            {loading ? (
              <>
                <CircularProgress />
                <Typography sx={{ mt: 2 }}>Analyzing unpaired streams...</Typography>
              </>
            ) : (
              <>
                <Typography>
                  Click Analyze to group all unpaired <strong>{sourceSystem}</strong> streams
                  by project, site, and parameter.
                </Typography>
                <Button
                  variant="contained"
                  onClick={handleAnalyze}
                  sx={{ mt: 2 }}
                  startIcon={<AutoFixHighIcon />}
                >
                  Analyze
                </Button>
              </>
            )}
          </Box>
        )}

        {/* Step 1: Review */}
        {activeStep === 1 && discovery && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              {discovery.total_streams} streams grouped into{' '}
              {discovery.projects.length} project(s), {discovery.sites.length} sites, and{' '}
              {discovery.parameters.length} parameters
            </Alert>

            {/* Projects */}
            <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
              Projects ({discovery.projects.length})
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Streams</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {discovery.projects.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell><strong>{p.name}</strong></TableCell>
                      <TableCell>{p.stream_count}</TableCell>
                      <TableCell>
                        <StatusChip existing={!!p.existing_id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Parameters */}
            <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
              Parameters ({discovery.parameters.length})
            </Typography>
            <TableContainer sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Units</TableCell>
                    <TableCell>Streams</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {discovery.parameters.map((p) => (
                    <ParameterRow key={p.name} param={p} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Sites */}
            <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>
              Sites ({discovery.sites.length})
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Glacier</TableCell>
                    <TableCell>Streams</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedSites.map((s) => (
                    <SiteRow key={s.name} site={s} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={discovery.sites.length}
              page={sitesPage}
              onPageChange={(_, p) => setSitesPage(p)}
              rowsPerPage={sitesPerPage}
              onRowsPerPageChange={(e) => {
                setSitesPerPage(parseInt(e.target.value, 10));
                setSitesPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </Box>
        )}

        {/* Step 2: Apply */}
        {activeStep === 2 && (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            {applying ? (
              <>
                <LinearProgress sx={{ mb: 2 }} />
                <Typography>Creating entities and pairing streams...</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  This may take a moment for large datasets
                </Typography>
              </>
            ) : result ? (
              <Alert severity="success">
                <strong>Complete.</strong> Paired {result.streams_paired} streams.
                Created {result.sites_created} sites and {result.parameters_created} parameters.
              </Alert>
            ) : null}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          {result ? 'Done' : 'Cancel'}
        </Button>
        {activeStep === 1 && (
          <Button
            variant="contained"
            onClick={handleApply}
            disabled={applying}
          >
            Apply ({discovery?.total_streams} streams)
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

const StatusChip = ({ existing }: { existing: boolean }) => (
  <Chip
    label={existing ? 'Exists' : 'Will Create'}
    color={existing ? 'success' : 'info'}
    size="small"
    variant="outlined"
  />
);

const SiteRow = ({ site }: { site: GroupedSite }) => (
  <TableRow>
    <TableCell>{site.name}</TableCell>
    <TableCell>{site.glacier ?? '-'}</TableCell>
    <TableCell>{site.stream_count}</TableCell>
    <TableCell><StatusChip existing={!!site.existing_id} /></TableCell>
  </TableRow>
);

const ParameterRow = ({ param }: { param: GroupedParameter }) => (
  <TableRow>
    <TableCell>{param.display_name}</TableCell>
    <TableCell>{param.units}</TableCell>
    <TableCell>{param.stream_count}</TableCell>
    <TableCell><StatusChip existing={!!param.existing_id} /></TableCell>
  </TableRow>
);
