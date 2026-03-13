import { useState, useCallback } from 'react';
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
} from '@mui/material';
import CalculateIcon from '@mui/icons-material/Calculate';
import DownloadIcon from '@mui/icons-material/Download';
import { useKeycloak } from '../../KeycloakContext';

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
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(`/api/service/tools/${toolName}/calculate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(inputs),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return data.results;
}

export const ToolLayout = ({ toolName, description, children, inputs, onResult }: ToolLayoutProps) => {
  const keycloak = useKeycloak();
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCalculate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = keycloak?.token;
      const res = await callToolApi(toolName, inputs, token);
      setResults(res);
      onResult?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calculation failed');
    } finally {
      setLoading(false);
    }
  }, [toolName, inputs, keycloak, onResult]);

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
              <Button size="small" startIcon={<DownloadIcon />} onClick={handleExport}>
                Export CSV
              </Button>
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
    </Box>
  );
};
