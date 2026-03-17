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
} from '@mui/material';
import CalculateIcon from '@mui/icons-material/Calculate';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const { data: sites } = useGetList('sites', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: siteParams } = useGetList('site_parameters', {
    filter: { site_id: siteId, is_active: true },
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  }, { enabled: !!siteId });

  const resultEntries = Object.entries(results).filter(([, v]) => typeof v === 'number' && v !== null);

  const mappings = useMemo(() => {
    if (!siteParams) return [];
    return resultEntries.map(([key, value]) => {
      const normalizedKey = key.toLowerCase().replace(/_/g, '');
      const match = siteParams.find(sp => {
        const normalizedName = sp.name.toLowerCase().replace(/[_\s]/g, '');
        return normalizedName.includes(normalizedKey) || normalizedKey.includes(normalizedName);
      });
      return { key, value: value as number, parameterId: match?.parameter_id ?? '', parameterName: match?.name ?? '' };
    });
  }, [resultEntries, siteParams]);

  const handleSave = async () => {
    const validMappings = mappings.filter(m => m.parameterId);
    if (validMappings.length === 0) {
      setError('No parameters mapped. Select a site with matching parameters.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const timestamp = new Date(dateTime).toISOString();
      const payload = {
        site_id: siteId,
        readings: validMappings.map(m => ({
          parameter_id: m.parameterId,
          value: m.value,
          time: timestamp,
        })),
      };

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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Save Results to Station</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <MuiTextField
          select label="Station" value={siteId}
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

        {siteId && mappings.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Result</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Maps to Parameter</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mappings.map(m => (
                <TableRow key={m.key}>
                  <TableCell>{m.key.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{typeof m.value === 'number' ? m.value.toFixed(4) : String(m.value)}</TableCell>
                  <TableCell>{m.parameterName || <Typography color="text.disabled">No match</Typography>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {error && <Alert severity="error">{error}</Alert>}
        {savedCount != null && <Alert severity="success">{savedCount} reading(s) saved</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={saving || !siteId}>
          {saving ? <CircularProgress size={16} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

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
                  Save to Station
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
                      <TableCell>{key.replace(/_/g, ' ')}</TableCell>
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
