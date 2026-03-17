import { useState, useCallback } from 'react';
import {
  Button,
  Popover,
  Box,
  Typography,
  MenuItem,
  TextField,
  CircularProgress,
  Alert,
} from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useGetList } from 'react-admin';

interface LoadStandardCurveButtonProps {
  onLoad: (slope: number, intercept: number) => void;
}

export const LoadStandardCurveButton: React.FC<LoadStandardCurveButtonProps> = ({ onLoad }) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [parameterId, setParameterId] = useState('');

  const { data: parameters, isLoading: paramsLoading } = useGetList('parameters', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const { data: curves, isLoading: curvesLoading, error } = useGetList(
    'standard_curves',
    {
      filter: { parameter_id: parameterId },
      sort: { field: 'valid_from', order: 'DESC' },
      pagination: { page: 1, perPage: 1 },
    },
    { enabled: !!parameterId },
  );

  const handleApply = useCallback(() => {
    if (curves && curves.length > 0) {
      onLoad(curves[0].slope, curves[0].intercept);
      setAnchorEl(null);
    }
  }, [curves, onLoad]);

  const open = Boolean(anchorEl);

  return (
    <>
      <Button
        size="small"
        startIcon={<FileDownloadIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        Load Standard Curve
      </Button>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 280 }}>
          <Typography variant="subtitle2">Load from Database</Typography>
          <TextField
            select
            label="Parameter"
            value={parameterId}
            onChange={(e) => setParameterId(e.target.value)}
            size="small"
            fullWidth
            disabled={paramsLoading}
          >
            {(parameters ?? []).map((p: any) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </TextField>

          {curvesLoading && <CircularProgress size={20} />}
          {error && <Alert severity="error" sx={{ py: 0 }}>Failed to load curves</Alert>}

          {parameterId && !curvesLoading && curves && curves.length === 0 && (
            <Alert severity="info" sx={{ py: 0 }}>No standard curves for this parameter</Alert>
          )}

          {curves && curves.length > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                Latest: slope={curves[0].slope}, intercept={curves[0].intercept}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                Valid from {new Date(curves[0].valid_from).toLocaleDateString()}
                {curves[0].r_squared != null && ` | R\u00B2=${curves[0].r_squared}`}
              </Typography>
            </Box>
          )}

          <Button
            variant="contained"
            size="small"
            onClick={handleApply}
            disabled={!curves || curves.length === 0}
          >
            Apply
          </Button>
        </Box>
      </Popover>
    </>
  );
};
