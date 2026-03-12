import React, { useState, useEffect } from 'react';
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
} from '@mui/material';

interface ExportParameter {
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
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedParamIds, setSelectedParamIds] = useState<Set<string>>(new Set());

  // Initialize all parameters as selected when parameters change or dialog opens
  useEffect(() => {
    if (open) {
      setSelectedParamIds(new Set(parameters.map((p) => p.id)));
    }
  }, [open, parameters]);

  const handleToggleParam = (paramId: string) => {
    setSelectedParamIds((prev) => {
      const next = new Set(prev);
      if (next.has(paramId)) {
        next.delete(paramId);
      } else {
        next.add(paramId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedParamIds(new Set(parameters.map((p) => p.id)));
  };

  const handleDeselectAll = () => {
    setSelectedParamIds(new Set());
  };

  const handleExport = async () => {
    setDownloading(true);
    setError(null);

    try {
      const start = new Date(startDate).toISOString();
      const end = new Date(endDate).toISOString();
      const formatParam = format === 'json' ? 'json' : 'csv';
      const paramIds = Array.from(selectedParamIds).join(',');
      const url = `/api/private/sites/${siteId}/readings?start=${start}&end=${end}&page_size=100000&format=${formatParam}&parameter_ids=${paramIds}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${siteName}_readings_${startDate.replace(/[T:]/g, '-')}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
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
        <FormControl>
          <FormLabel>Format</FormLabel>
          <RadioGroup
            row
            value={format}
            onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}
          >
            <FormControlLabel value="csv" control={<Radio />} label="CSV" />
            <FormControlLabel value="json" control={<Radio />} label="JSON" />
          </RadioGroup>
        </FormControl>

        {parameters.length > 0 && (
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
              {parameters.map((param) => (
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

        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={downloading}>Cancel</Button>
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
