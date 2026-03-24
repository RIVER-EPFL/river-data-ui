import { useState, useMemo, useCallback } from 'react';
import {
  TextField,
  Box,
  Typography,
  Button,
  IconButton,
  Divider,
  Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ToolLayout } from './ToolLayout';
import { LoadStandardCurveButton } from './LoadStandardCurveButton';

/** Returns true if the string is non-empty but not a valid finite number */
const isInvalidNumber = (v: string): boolean => v !== '' && (isNaN(Number(v)) || !isFinite(Number(v)));

interface ReplicateState {
  fluorBefore: string;
  fluorAfter: string;
  volTotal: string;
  volAfter: string;
  d1: string;
  d2: string;
  d3: string;
  afdm: string;
}

const emptyReplicate = (): ReplicateState => ({
  fluorBefore: '',
  fluorAfter: '',
  volTotal: '',
  volAfter: '',
  d1: '',
  d2: '',
  d3: '',
  afdm: '',
});

const MAX_REPLICATES = 5;

export const ChlaBenthicTool = () => {
  // Standard curve parameters
  const [acidSlope, setAcidSlope] = useState('');
  const [acidIntercept, setAcidIntercept] = useState('');
  const [noacidSlope, setNoacidSlope] = useState('');
  const [noacidIntercept, setNoacidIntercept] = useState('');

  // Replicates (start with 3)
  const [replicates, setReplicates] = useState<ReplicateState[]>([
    emptyReplicate(),
    emptyReplicate(),
    emptyReplicate(),
  ]);

  const handleLoadAcidCurve = useCallback((s: number, i: number) => {
    setAcidSlope(String(s));
    setAcidIntercept(String(i));
  }, []);

  const handleLoadNoacidCurve = useCallback((s: number, i: number) => {
    setNoacidSlope(String(s));
    setNoacidIntercept(String(i));
  }, []);

  const updateReplicate = useCallback(
    (index: number, field: keyof ReplicateState, value: string) => {
      setReplicates((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        return next;
      });
    },
    [],
  );

  const addReplicate = useCallback(() => {
    setReplicates((prev) =>
      prev.length < MAX_REPLICATES ? [...prev, emptyReplicate()] : prev,
    );
  }, []);

  const removeReplicate = useCallback((index: number) => {
    setReplicates((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const inputs = useMemo(() => {
    const replicateInputs = replicates
      .filter((r) => r.fluorBefore !== '')
      .map((r) => {
        const diameters = [r.d1, r.d2, r.d3]
          .filter((d) => d !== '')
          .map(Number)
          .filter((d) => !isNaN(d));

        return {
          fluor_before: Number(r.fluorBefore) || 0,
          fluor_after: r.fluorAfter !== '' ? Number(r.fluorAfter) : null,
          vol_total_ml: Number(r.volTotal) || 0,
          vol_after_ml: Number(r.volAfter) || 0,
          diameters_cm: diameters,
          afdm_g_filter: r.afdm !== '' ? Number(r.afdm) : null,
        };
      });

    return {
      acid_slope: Number(acidSlope) || 0,
      acid_intercept: Number(acidIntercept) || 0,
      noacid_slope: Number(noacidSlope) || 0,
      noacid_intercept: Number(noacidIntercept) || 0,
      replicates: replicateInputs,
    };
  }, [acidSlope, acidIntercept, noacidSlope, noacidIntercept, replicates]);

  const labels = 'ABCDE';

  return (
    <ToolLayout
      toolName="chla_benthic"
      description="Unified Chlorophyll-Benthic tool: processes up to 5 replicates with acid/no-acid Chl-a, per-m2 normalizations, benthic AFDM, and cross-replicate averages/SDs."
      inputs={inputs}
    >
      {/* Standard Curves */}
      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Acid Standard Curve
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Slope"
              value={acidSlope}
              onChange={(e) => setAcidSlope(e.target.value)}
              type="number"
              size="small"
              sx={{ width: 120 }}
              error={isInvalidNumber(acidSlope)}
              helperText={isInvalidNumber(acidSlope) ? 'Must be a number' : undefined}
            />
            <TextField
              label="Intercept"
              value={acidIntercept}
              onChange={(e) => setAcidIntercept(e.target.value)}
              type="number"
              size="small"
              sx={{ width: 120 }}
              error={isInvalidNumber(acidIntercept)}
              helperText={isInvalidNumber(acidIntercept) ? 'Must be a number' : undefined}
            />
            <LoadStandardCurveButton onLoad={handleLoadAcidCurve} />
          </Box>
        </Box>
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            No-Acid Standard Curve
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Slope"
              value={noacidSlope}
              onChange={(e) => setNoacidSlope(e.target.value)}
              type="number"
              size="small"
              sx={{ width: 120 }}
              error={isInvalidNumber(noacidSlope)}
              helperText={isInvalidNumber(noacidSlope) ? 'Must be a number' : undefined}
            />
            <TextField
              label="Intercept"
              value={noacidIntercept}
              onChange={(e) => setNoacidIntercept(e.target.value)}
              type="number"
              size="small"
              sx={{ width: 120 }}
              error={isInvalidNumber(noacidIntercept)}
              helperText={isInvalidNumber(noacidIntercept) ? 'Must be a number' : undefined}
            />
            <LoadStandardCurveButton onLoad={handleLoadNoacidCurve} />
          </Box>
        </Box>
      </Box>

      <Divider sx={{ my: 1 }} />

      {/* Replicates */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">
          Replicates ({replicates.length}/{MAX_REPLICATES})
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={addReplicate}
          disabled={replicates.length >= MAX_REPLICATES}
        >
          Add Replicate
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {replicates.map((rep, idx) => (
          <Paper key={idx} variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Replicate {labels[idx]}
              </Typography>
              <IconButton
                size="small"
                onClick={() => removeReplicate(idx)}
                disabled={replicates.length <= 1}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {/* Fluorescence */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Fluorescence
                </Typography>
                <TextField
                  label="Before"
                  value={rep.fluorBefore}
                  onChange={(e) => updateReplicate(idx, 'fluorBefore', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 120 }}
                  required
                  error={isInvalidNumber(rep.fluorBefore)}
                  helperText={isInvalidNumber(rep.fluorBefore) ? 'Must be a number' : undefined}
                />
                <TextField
                  label="After (acid)"
                  value={rep.fluorAfter}
                  onChange={(e) => updateReplicate(idx, 'fluorAfter', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 120 }}
                />
              </Box>

              {/* Volumes */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Volumes (mL)
                </Typography>
                <TextField
                  label="Total"
                  value={rep.volTotal}
                  onChange={(e) => updateReplicate(idx, 'volTotal', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 120 }}
                  required
                />
                <TextField
                  label="After filtration"
                  value={rep.volAfter}
                  onChange={(e) => updateReplicate(idx, 'volAfter', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 120 }}
                  required
                />
              </Box>

              {/* Rock Diameters */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Rock Diameters (cm)
                </Typography>
                <TextField
                  label="D1"
                  value={rep.d1}
                  onChange={(e) => updateReplicate(idx, 'd1', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 100 }}
                  required
                />
                <TextField
                  label="D2"
                  value={rep.d2}
                  onChange={(e) => updateReplicate(idx, 'd2', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 100 }}
                  required
                />
                <TextField
                  label="D3"
                  value={rep.d3}
                  onChange={(e) => updateReplicate(idx, 'd3', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 100 }}
                  required
                />
              </Box>

              {/* AFDM */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  AFDM
                </Typography>
                <TextField
                  label="Weight (g)"
                  value={rep.afdm}
                  onChange={(e) => updateReplicate(idx, 'afdm', e.target.value)}
                  type="number"
                  size="small"
                  sx={{ width: 120 }}
                />
              </Box>
            </Box>
          </Paper>
        ))}
      </Box>
    </ToolLayout>
  );
};
