import React, { useState, useEffect } from 'react';
import { useGetList } from 'react-admin';
import { useKeycloak } from '../../KeycloakContext';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
  FormGroup,
  CircularProgress,
  Alert,
  Box,
  MenuItem,
} from '@mui/material';

export interface ExportParameter {
  id: string;
  name: string;
  is_derived: boolean;
}

interface SiteRecord {
  id: string;
  name: string;
}

interface DataExportDialogProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  siteName: string;
  parameters: ExportParameter[];
}

type AggregationLevel = 'raw' | 'hourly' | 'daily' | 'weekly' | 'monthly';
type ExportFormat = 'csv' | 'json' | 'ndjson';

export const DataExportDialog: React.FC<DataExportDialogProps> = ({
  open,
  onClose,
  siteId,
  siteName,
  parameters,
}) => {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [startDate, setStartDate] = useState(dayAgo.toISOString().slice(0, 16));
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 16));
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [aggregation, setAggregation] = useState<AggregationLevel>('raw');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedParamIds, setSelectedParamIds] = useState<Set<string>>(new Set());
  const [includeDerived, setIncludeDerived] = useState(false);
  const [additionalSiteIds, setAdditionalSiteIds] = useState<Set<string>>(new Set());
  const keycloak = useKeycloak();

  const { data: allSites } = useGetList<SiteRecord>('sites', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  const otherSites = (allSites ?? []).filter((s) => s.id !== siteId);
  const nonDerivedParams = parameters.filter((p) => !p.is_derived);
  const derivedParams = parameters.filter((p) => p.is_derived);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedParamIds(new Set(nonDerivedParams.map((p) => p.id)));
      setIncludeDerived(false);
      setAdditionalSiteIds(new Set());
      setAggregation('raw');
      setError(null);
    }
  }, [open, parameters]);

  const handleToggleParam = (paramId: string) => {
    setSelectedParamIds((prev) => {
      const next = new Set(prev);
      if (next.has(paramId)) next.delete(paramId);
      else next.add(paramId);
      return next;
    });
  };

  const handleSelectAll = () => {
    const ids = includeDerived ? parameters.map((p) => p.id) : nonDerivedParams.map((p) => p.id);
    setSelectedParamIds(new Set(ids));
  };

  const handleDeselectAll = () => {
    setSelectedParamIds(new Set());
  };

  const handleIncludeDerivedChange = (checked: boolean) => {
    setIncludeDerived(checked);
    setSelectedParamIds((prev) => {
      const next = new Set(prev);
      derivedParams.forEach((p) => {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      });
      return next;
    });
  };

  const handleToggleSite = (id: string) => {
    setAdditionalSiteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildUrl = (sid: string, paramIds?: string) => {
    const start = new Date(startDate).toISOString();
    const end = new Date(endDate).toISOString();
    const dataPath = aggregation === 'raw' ? 'readings' : `aggregates/${aggregation}`;
    let url = `/api/service/sites/${sid}/${dataPath}?start=${start}&end=${end}&page_size=100000&format=${format}`;
    if (paramIds) url += `&parameter_ids=${paramIds}`;
    return url;
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    setDownloading(true);
    setError(null);

    try {
      const headers: HeadersInit = keycloak?.token
        ? { Authorization: 'Bearer ' + keycloak.token }
        : {};
      const paramIds = Array.from(selectedParamIds).join(',');
      const allSiteIds = [siteId, ...Array.from(additionalSiteIds)];
      const ext = format === 'ndjson' ? 'ndjson' : format;
      const label = aggregation === 'raw' ? 'readings' : aggregation;

      if (allSiteIds.length === 1) {
        const url = buildUrl(siteId, paramIds);
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const blob = await res.blob();
        triggerDownload(
          blob,
          `${siteName}_${label}_${startDate.replace(/[T:]/g, '-')}.${ext}`,
        );
      } else {
        // Multiple sites — fetch all and merge
        const responses = await Promise.all(
          allSiteIds.map(async (sid) => {
            const isCurrentSite = sid === siteId;
            const url = buildUrl(sid, isCurrentSite ? paramIds : undefined);
            const res = await fetch(url, { headers });
            if (!res.ok) {
              const name =
                isCurrentSite
                  ? siteName
                  : (otherSites.find((s) => s.id === sid)?.name ?? sid);
              throw new Error(`${name}: HTTP ${res.status}`);
            }
            return res.text();
          }),
        );

        let merged: string;
        let mimeType: string;

        if (format === 'csv') {
          merged = responses
            .map((text, i) => {
              if (i === 0) return text.trimEnd();
              const lines = text.split('\n');
              return lines.slice(1).join('\n').trimEnd();
            })
            .filter((t) => t.length > 0)
            .join('\n');
          mimeType = 'text/csv';
        } else if (format === 'ndjson') {
          merged = responses
            .map((t) => t.trimEnd())
            .filter((t) => t.length > 0)
            .join('\n');
          mimeType = 'application/x-ndjson';
        } else {
          const parsed = responses.map((r) => {
            try {
              return JSON.parse(r);
            } catch {
              return r;
            }
          });
          merged = JSON.stringify(parsed, null, 2);
          mimeType = 'application/json';
        }

        const blob = new Blob([merged], { type: mimeType });
        triggerDownload(
          blob,
          `multi-site_${label}_${startDate.replace(/[T:]/g, '-')}.${ext}`,
        );
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export Data: {siteName}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <TextField
          label="Start Date"
          type="datetime-local"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          fullWidth
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="End Date"
          type="datetime-local"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          fullWidth
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
        />

        <TextField
          select
          label="Aggregation Level"
          value={aggregation}
          onChange={(e) => setAggregation(e.target.value as AggregationLevel)}
          fullWidth
          size="small"
        >
          <MenuItem value="raw">Raw</MenuItem>
          <MenuItem value="hourly">Hourly</MenuItem>
          <MenuItem value="daily">Daily</MenuItem>
          <MenuItem value="weekly">Weekly</MenuItem>
          <MenuItem value="monthly">Monthly</MenuItem>
        </TextField>

        <FormControl>
          <FormLabel>Format</FormLabel>
          <RadioGroup
            row
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
          >
            <FormControlLabel value="csv" control={<Radio />} label="CSV" />
            <FormControlLabel value="json" control={<Radio />} label="JSON" />
            <FormControlLabel value="ndjson" control={<Radio />} label="NDJSON" />
          </RadioGroup>
        </FormControl>

        {nonDerivedParams.length > 0 && (
          <FormControl component="fieldset">
            <FormLabel component="legend">Parameters</FormLabel>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, mt: 0.5 }}>
              <Button size="small" onClick={handleSelectAll}>
                Select All
              </Button>
              <Button size="small" onClick={handleDeselectAll}>
                Deselect All
              </Button>
            </Box>
            <FormGroup sx={{ maxHeight: 200, overflowY: 'auto' }}>
              {nonDerivedParams.map((param) => (
                <FormControlLabel
                  key={param.id}
                  control={
                    <Checkbox
                      checked={selectedParamIds.has(param.id)}
                      onChange={() => handleToggleParam(param.id)}
                      size="small"
                    />
                  }
                  label={param.name}
                />
              ))}
            </FormGroup>
          </FormControl>
        )}

        {derivedParams.length > 0 && (
          <>
            <FormControlLabel
              control={
                <Checkbox
                  checked={includeDerived}
                  onChange={(e) => handleIncludeDerivedChange(e.target.checked)}
                />
              }
              label="Include derived parameters"
            />
            {includeDerived && (
              <FormGroup sx={{ ml: 3, maxHeight: 120, overflowY: 'auto' }}>
                {derivedParams.map((param) => (
                  <FormControlLabel
                    key={param.id}
                    control={
                      <Checkbox
                        checked={selectedParamIds.has(param.id)}
                        onChange={() => handleToggleParam(param.id)}
                        size="small"
                      />
                    }
                    label={param.name}
                  />
                ))}
              </FormGroup>
            )}
          </>
        )}

        {otherSites.length > 0 && (
          <FormControl component="fieldset">
            <FormLabel component="legend">Additional Sites</FormLabel>
            <FormGroup sx={{ maxHeight: 150, overflowY: 'auto' }}>
              {otherSites.map((s) => (
                <FormControlLabel
                  key={s.id}
                  control={
                    <Checkbox
                      checked={additionalSiteIds.has(s.id)}
                      onChange={() => handleToggleSite(s.id)}
                      size="small"
                    />
                  }
                  label={s.name}
                />
              ))}
            </FormGroup>
          </FormControl>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={downloading}>
          Cancel
        </Button>
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={downloading || selectedParamIds.size === 0}
          startIcon={downloading ? <CircularProgress size={16} /> : undefined}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
};
