import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TableHead,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField as MuiTextField,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import CalculateIcon from '@mui/icons-material/Calculate';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import LinkIcon from '@mui/icons-material/Link';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useGetList } from 'react-admin';
import { useAuthFetch } from '../../hooks/useAuthFetch';

type AuthFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

interface ToolLayoutProps {
  toolName: string;
  description: string;
  children: React.ReactNode;
  inputs: Record<string, unknown>;
  onResult?: (result: Record<string, unknown>) => void;
}

async function callToolApi(
  toolName: string,
  inputs: Record<string, unknown>,
  authFetch: AuthFetchFn,
): Promise<Record<string, unknown>> {
  const resp = await authFetch(`/api/service/tools/${toolName}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inputs),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.results;
}

// --------------------------------------------------------------------------
// SaveToStationDialog
// --------------------------------------------------------------------------

interface ParameterRecord {
  id: string;
  name: string;
  display_name: string;
  default_units: string;
  category: string;
}

interface MappingEntry {
  key: string;
  value: number;
  parameterId: string;
  parameterName: string;
  linked: boolean;     // true if site_parameter already exists
  linkable: boolean;   // true if parameter exists in catalog but not linked to site
  globalParamId: string; // the parameter UUID from global catalog
}

interface SaveToStationDialogProps {
  open: boolean;
  onClose: () => void;
  results: Record<string, unknown>;
  toolName: string;
}

const SaveToStationDialog: React.FC<SaveToStationDialogProps> = ({ open, onClose, results, toolName }) => {
  const authFetch = useAuthFetch();
  const [siteId, setSiteId] = useState('');
  const [dateTime, setDateTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [fieldTripId, setFieldTripId] = useState('');
  const [saving, setSaving] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [linkVersion, setLinkVersion] = useState(0);

  const { data: sites } = useGetList('sites', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: siteParams, refetch: refetchSiteParams } = useGetList('site_parameters', {
    filter: { site_id: siteId, is_active: true },
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
    meta: { _version: linkVersion },
  }, { enabled: !!siteId });

  // Fetch all parameters from global catalog to find matches by exact name
  const { data: allParams } = useGetList('parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: fieldTrips } = useGetList('field_trips', {
    pagination: { page: 1, perPage: 50 },
    sort: { field: 'date', order: 'DESC' },
  });

  const resultEntries = Object.entries(results).filter(([, v]) => typeof v === 'number' && v !== null);

  // Exact-match mapping: result key matches parameters.name exactly
  const mappings: MappingEntry[] = useMemo(() => {
    if (!allParams) return [];
    const paramsByName = new Map<string, ParameterRecord>();
    for (const p of allParams) {
      paramsByName.set(p.name, p as unknown as ParameterRecord);
    }

    const siteParamsByParamId = new Map<string, any>();
    if (siteParams) {
      for (const sp of siteParams) {
        siteParamsByParamId.set(sp.parameter_id, sp);
      }
    }

    return resultEntries.map(([key, value]) => {
      const globalParam = paramsByName.get(key);
      if (!globalParam) {
        return { key, value: value as number, parameterId: '', parameterName: '', linked: false, linkable: false, globalParamId: '' };
      }

      const siteParam = siteParamsByParamId.get(globalParam.id);
      if (siteParam) {
        return { key, value: value as number, parameterId: globalParam.id, parameterName: globalParam.display_name, linked: true, linkable: false, globalParamId: globalParam.id };
      }

      // Parameter exists in catalog but not linked to this site
      return { key, value: value as number, parameterId: globalParam.id, parameterName: globalParam.display_name, linked: false, linkable: true, globalParamId: globalParam.id };
    });
  }, [resultEntries, allParams, siteParams]);

  const linkedMappings = mappings.filter(m => m.linked);
  const linkableMappings = mappings.filter(m => m.linkable);
  const unmatchedMappings = mappings.filter(m => !m.linked && !m.linkable);

  const handleLinkParameter = async (m: MappingEntry) => {
    if (!siteId || !m.globalParamId) return;
    setLinking(m.key);
    try {
      const resp = await authFetch('/api/service/site_parameters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          parameter_id: m.globalParamId,
          name: m.parameterName,
          is_active: true,
          is_derived: false,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      setLinkVersion(v => v + 1);
      refetchSiteParams();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to link parameter');
    } finally {
      setLinking(null);
    }
  };

  const handleLinkAll = async () => {
    for (const m of linkableMappings) {
      await handleLinkParameter(m);
    }
  };

  const handleSave = async () => {
    const saveable = mappings.filter(m => m.linked);
    if (saveable.length === 0) {
      setError('No parameters linked to this site. Click "Link" to add them first.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const timestamp = new Date(dateTime).toISOString();
      const payload: Record<string, unknown> = {
        site_id: siteId,
        readings: saveable.map(m => ({
          parameter_id: m.parameterId,
          value: m.value,
          time: timestamp,
        })),
      };
      if (fieldTripId) {
        payload.field_trip_id = fieldTripId;
      }

      const resp = await authFetch('/api/service/grab_samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();
      setSavedCount(result.inserted);
      setTimeout(() => { onClose(); setSavedCount(null); }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Save Results to Site</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <MuiTextField
            select label="Site" value={siteId}
            onChange={(e) => setSiteId(e.target.value)} size="small" fullWidth
          >
            {(sites ?? []).map((s: any) => (
              <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>
            ))}
          </MuiTextField>

          <MuiTextField
            label="Date / Time" type="datetime-local" value={dateTime}
            onChange={(e) => setDateTime(e.target.value)} size="small" fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>

        <MuiTextField
          select label="Field Trip (optional)" value={fieldTripId}
          onChange={(e) => setFieldTripId(e.target.value)} size="small" fullWidth
        >
          <MenuItem value="">None</MenuItem>
          {(fieldTrips ?? []).map((ft: any) => (
            <MenuItem key={ft.id} value={ft.id}>
              {ft.date}{ft.participants ? ` — ${ft.participants}` : ''}
            </MenuItem>
          ))}
        </MuiTextField>

        {siteId && mappings.length > 0 && (
          <>
            {linkableMappings.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Alert severity="info" sx={{ flex: 1 }}>
                  {linkableMappings.length} parameter(s) exist but aren't linked to this site yet.
                </Alert>
                <Button size="small" variant="outlined" onClick={handleLinkAll} disabled={!!linking}>
                  Link All
                </Button>
              </Box>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Result</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell>Parameter</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappings.map(m => (
                  <TableRow key={m.key} sx={{ opacity: m.linked ? 1 : 0.7 }}>
                    <TableCell>{m.key}</TableCell>
                    <TableCell>{typeof m.value === 'number' ? m.value.toFixed(4) : String(m.value)}</TableCell>
                    <TableCell>{m.parameterName || <Typography color="text.disabled" variant="body2">Not in catalog</Typography>}</TableCell>
                    <TableCell align="center">
                      {m.linked && (
                        <Tooltip title="Linked to site">
                          <CheckCircleIcon color="success" fontSize="small" />
                        </Tooltip>
                      )}
                      {m.linkable && (
                        <Tooltip title="Click to link this parameter to the site">
                          <IconButton
                            size="small"
                            onClick={() => handleLinkParameter(m)}
                            disabled={linking === m.key}
                          >
                            {linking === m.key ? <CircularProgress size={16} /> : <LinkIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      )}
                      {!m.linked && !m.linkable && (
                        <Chip label="No match" size="small" variant="outlined" color="warning" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {linkedMappings.length > 0 && (
              <Typography variant="body2" color="text.secondary">
                {linkedMappings.length} of {mappings.length} result(s) will be saved.
                {unmatchedMappings.length > 0 && ` ${unmatchedMappings.length} not in parameter catalog.`}
              </Typography>
            )}
          </>
        )}

        {error && <Alert severity="error">{error}</Alert>}
        {savedCount != null && <Alert severity="success">{savedCount} reading(s) saved</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !siteId || linkedMappings.length === 0}>
          {saving ? <CircularProgress size={16} /> : `Save ${linkedMappings.length} Reading(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// --------------------------------------------------------------------------
// ToolLayout
// --------------------------------------------------------------------------

export const ToolLayout = ({ toolName, description, children, inputs, onResult }: ToolLayoutProps) => {
  const authFetch = useAuthFetch();
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const handleCalculate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await callToolApi(toolName, inputs, authFetch);
      setResults(res);
      onResult?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }, [toolName, inputs, authFetch, onResult]);

  const handleExport = useCallback(() => {
    if (!results) return;
    const lines = Object.entries(results)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k},${v}`)
      .join('\n');
    const blob = new Blob([`parameter,value\n${lines}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${toolName}_result.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results, toolName]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>

      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle2">Inputs</Typography>
          {children}
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} /> : <CalculateIcon />}
            onClick={handleCalculate}
            disabled={loading}
            sx={{ alignSelf: 'flex-start' }}
          >
            Calculate
          </Button>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {results && (
        <Card variant="outlined">
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2">Results</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" startIcon={<DownloadIcon />} onClick={handleExport}>
                  Export CSV
                </Button>
                <Button size="small" startIcon={<SaveIcon />} onClick={() => setSaveOpen(true)}>
                  Save to Site
                </Button>
              </Box>
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Parameter</TableCell>
                  <TableCell align="right">Value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(results)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([key, value]) => (
                    <TableRow key={key}>
                      <TableCell>{key}</TableCell>
                      <TableCell align="right">
                        {typeof value === 'number' ? value.toFixed(6) : String(value)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {results && (
        <SaveToStationDialog
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          results={results}
          toolName={toolName}
        />
      )}
    </Box>
  );
};
