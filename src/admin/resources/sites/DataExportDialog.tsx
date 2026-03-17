import React, { useState, useEffect } from 'react';
import { useGetList } from 'react-admin';
import { useAuthFetch } from '../../hooks/useAuthFetch';
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
  Divider,
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
  const [includeGrabSamples, setIncludeGrabSamples] = useState(false);
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [comparisonParamId, setComparisonParamId] = useState('');
  const [comparisonTolerance, setComparisonTolerance] = useState(10); // minutes
  const authFetch = useAuthFetch();

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
      setIncludeGrabSamples(false);
      setIncludeFlagged(false);
      setIncludeAnnotations(false);
      setComparisonMode(false);
      setComparisonParamId('');
      setComparisonTolerance(10);
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
    if (includeFlagged) url += `&include_flagged=true`;
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

  const handleComparisonExport = async () => {
    setDownloading(true);
    setError(null);
    try {
      const start = new Date(startDate).toISOString();
      const end = new Date(endDate).toISOString();

      // Fetch continuous readings
      const contUrl = `/api/service/sites/${siteId}/readings?start=${start}&end=${end}&parameter_ids=${comparisonParamId}&measurement_type=continuous&page_size=100000&format=json`;
      const contRes = await authFetch(contUrl);
      if (!contRes.ok) throw new Error(`Continuous fetch: HTTP ${contRes.status}`);
      const contData = await contRes.json();

      // Fetch spot (grab sample) readings
      const spotUrl = `/api/service/sites/${siteId}/readings?start=${start}&end=${end}&parameter_ids=${comparisonParamId}&measurement_type=spot&page_size=100000&format=json`;
      const spotRes = await authFetch(spotUrl);
      if (!spotRes.ok) throw new Error(`Spot fetch: HTTP ${spotRes.status}`);
      const spotData = await spotRes.json();

      if (!spotData.times?.length) throw new Error('No grab sample data found for this parameter and time range');

      const contTimes = (contData.times ?? []).map((t: string) => new Date(t).getTime());
      const contValues = contData.parameters?.[0]?.values ?? [];
      const toleranceMs = comparisonTolerance * 60 * 1000;

      // Pair each spot reading with nearest continuous reading
      const csvLines = ['timestamp,sensor_value,grab_value,difference,time_offset_seconds'];
      const spotTimes = spotData.times as string[];
      const spotValues = spotData.parameters?.[0]?.values ?? [];

      for (let i = 0; i < spotTimes.length; i++) {
        const spotTime = new Date(spotTimes[i]).getTime();
        const spotVal = spotValues[i];
        if (spotVal == null) continue;

        // Find nearest continuous reading
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let j = 0; j < contTimes.length; j++) {
          const diff = Math.abs(contTimes[j] - spotTime);
          if (diff < bestDiff && diff <= toleranceMs) {
            bestDiff = diff;
            bestIdx = j;
          }
        }

        const sensorVal = bestIdx >= 0 ? contValues[bestIdx] : null;
        const diff = sensorVal != null && spotVal != null ? (spotVal - sensorVal).toFixed(4) : '';
        const offset = bestIdx >= 0 ? ((contTimes[bestIdx] - spotTime) / 1000).toFixed(0) : '';

        csvLines.push(
          `${spotTimes[i]},${sensorVal ?? ''},${spotVal},${diff},${offset}`
        );
      }

      const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison_${siteName}_${startDate.replace(/[T:]/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison export failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleExport = async () => {
    setDownloading(true);
    setError(null);

    try {
      const paramIds = Array.from(selectedParamIds).join(',');
      const allSiteIds = [siteId, ...Array.from(additionalSiteIds)];
      const ext = format === 'ndjson' ? 'ndjson' : format;
      const label = aggregation === 'raw' ? 'readings' : aggregation;

      if (allSiteIds.length === 1) {
        const url = buildUrl(siteId, paramIds);
        const res = await authFetch(url);
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
            const res = await authFetch(url);
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

      // Fetch and append grab samples if requested
      if (includeGrabSamples && format === 'csv') {
        await Promise.all(allSiteIds.map(async (sid) => {
          const isCurrentSite = sid === siteId;
          const start = new Date(startDate).toISOString();
          const end = new Date(endDate).toISOString();
          let spotUrl = `/api/service/sites/${sid}/readings?start=${start}&end=${end}&measurement_type=spot&page_size=100000&format=csv`;
          if (isCurrentSite && paramIds) spotUrl += `&parameter_ids=${paramIds}`;
          try {
            const spotRes = await authFetch(spotUrl);
            if (spotRes.ok) {
              const spotText = await spotRes.text();
              if (spotText.trim()) {
                const spotLines = spotText.split('\n');
                // Skip header row and append data rows
                const spotData = spotLines.slice(1).filter((l) => l.trim()).join('\n');
                if (spotData) {
                  const spotBlob = new Blob([spotData + '\n'], { type: 'text/csv' });
                  const spotSiteName = isCurrentSite
                    ? siteName
                    : (otherSites.find((s) => s.id === sid)?.name ?? sid);
                  triggerDownload(
                    spotBlob,
                    `${spotSiteName}_grab-samples_${startDate.replace(/[T:]/g, '-')}.csv`,
                  );
                }
              }
            }
          } catch (err) { console.error('Failed to fetch spot/grab sample data for export:', err); }
        }));
      }

      // Annotations export — fetch annotations for the site and export as separate CSV
      if (includeAnnotations && format === 'csv') {
        await Promise.all(allSiteIds.map(async (sid) => {
          try {
            const annUrl = `/api/service/annotations?site_id=${sid}&sort=start_time:ASC&range=[0,999]`;
            const annRes = await authFetch(annUrl);
            if (annRes.ok) {
              const annotations = await annRes.json();
              const annData = Array.isArray(annotations) ? annotations : (annotations.data ?? []);
              // Filter to time range client-side (CrudCrate doesn't support time range filters)
              const startMs = new Date(startDate).getTime();
              const endMs = new Date(endDate).getTime();
              const filtered = annData.filter((a: { start_time: string; end_time: string }) => {
                const aStart = new Date(a.start_time).getTime();
                const aEnd = new Date(a.end_time).getTime();
                return aEnd >= startMs && aStart <= endMs;
              });
              if (filtered.length > 0) {
                const annLines = ['start_time,end_time,parameter_id,category,text,created_by'];
                for (const a of filtered) {
                  const text = String(a.text ?? '').replace(/"/g, '""');
                  annLines.push(
                    `${a.start_time},${a.end_time},${a.parameter_id},${a.category ?? ''},"${text}",${a.created_by ?? ''}`
                  );
                }
                const annBlob = new Blob([annLines.join('\n')], { type: 'text/csv' });
                const annSiteName = sid === siteId
                  ? siteName
                  : (otherSites.find((s) => s.id === sid)?.name ?? sid);
                triggerDownload(
                  annBlob,
                  `${annSiteName}_annotations_${startDate.replace(/[T:]/g, '-')}.csv`,
                );
              }
            }
          } catch (err) { console.error('Failed to fetch annotation data for export:', err); }
        }));
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

        <FormControl component="fieldset">
          <FormLabel component="legend">Include Additional Data</FormLabel>
          <FormGroup>
            <FormControlLabel
              control={<Checkbox checked={includeFlagged} onChange={(e) => setIncludeFlagged(e.target.checked)} size="small" />}
              label="Include flagged readings"
            />
            <FormControlLabel
              control={<Checkbox checked={includeGrabSamples} onChange={(e) => setIncludeGrabSamples(e.target.checked)} size="small" />}
              label="Include grab samples"
            />
            <FormControlLabel
              control={<Checkbox checked={includeAnnotations} onChange={(e) => setIncludeAnnotations(e.target.checked)} size="small" />}
              label="Include annotations"
            />
          </FormGroup>
        </FormControl>

        <Divider sx={{ my: 1 }} />
        <FormControlLabel
          control={<Checkbox checked={comparisonMode} onChange={(e) => setComparisonMode(e.target.checked)} />}
          label="Comparison Export (sensor vs. grab samples)"
        />
        {comparisonMode && (
          <Box sx={{ ml: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField
              select
              label="Parameter to Compare"
              value={comparisonParamId}
              onChange={(e) => setComparisonParamId(e.target.value)}
              size="small"
              fullWidth
            >
              {nonDerivedParams.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Time Tolerance (minutes)"
              type="number"
              value={comparisonTolerance}
              onChange={(e) => setComparisonTolerance(parseInt(e.target.value) || 10)}
              size="small"
              sx={{ width: 200 }}
              inputProps={{ min: 1, max: 60 }}
            />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={downloading}>
          Cancel
        </Button>
        <Button
          onClick={comparisonMode ? handleComparisonExport : handleExport}
          variant="contained"
          disabled={downloading || (comparisonMode ? !comparisonParamId : selectedParamIds.size === 0)}
          startIcon={downloading ? <CircularProgress size={16} /> : undefined}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
};
