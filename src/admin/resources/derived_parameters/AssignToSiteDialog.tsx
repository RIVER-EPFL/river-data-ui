import React, { useState, useMemo } from 'react';
import {
  useGetList,
  useCreate,
  useNotify,
  useRefresh,
} from 'react-admin';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Typography,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';

interface DerivedDefinition {
  id: string;
  name: string;
  display_name: string | null;
  formula: string;
  units: string | null;
  required_parameter_types: string[];
}

interface SiteRecord {
  id: string;
  name: string;
}

interface SiteParameterRecord {
  id: string;
  site_id: string;
  parameter_type_id: string;
  name: string;
  is_active: boolean;
}

interface ParameterRecord {
  id: string;
  name: string;
  display_name: string | null;
}

interface AssignToSiteDialogProps {
  open: boolean;
  onClose: () => void;
  definition: DerivedDefinition;
}

export const AssignToSiteDialog: React.FC<AssignToSiteDialogProps> = ({
  open,
  onClose,
  definition,
}) => {
  const [targetSiteId, setTargetSiteId] = useState('');
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();

  // Fetch all sites
  const { data: sites } = useGetList<SiteRecord>('sites', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  // Fetch site_parameters for selected site
  const { data: siteParams } = useGetList<SiteParameterRecord>('site_parameters', {
    filter: { site_id: targetSiteId },
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  }, { enabled: !!targetSiteId });

  // Fetch global parameter catalog for name resolution
  const { data: globalParams } = useGetList<ParameterRecord>('parameters', {
    pagination: { page: 1, perPage: 200 },
    sort: { field: 'name', order: 'ASC' },
  });

  // Check availability of required parameter types at the selected site
  const availability = useMemo(() => {
    if (!targetSiteId || !siteParams || !globalParams || !definition.required_parameter_types) {
      return [];
    }

    // Build a map: global parameter ID → name
    const paramNameById = new Map(globalParams.map((p) => [p.id, p.name]));

    // Build a map: parameter type name → site_parameter at this site
    const siteParamByTypeName = new Map<string, SiteParameterRecord>();
    for (const sp of siteParams) {
      const typeName = paramNameById.get(sp.parameter_type_id);
      if (typeName) {
        siteParamByTypeName.set(typeName, sp);
      }
    }

    return definition.required_parameter_types.map((typeName) => {
      const siteParam = siteParamByTypeName.get(typeName);
      return {
        typeName,
        siteParam,
        available: !!siteParam,
      };
    });
  }, [targetSiteId, siteParams, globalParams, definition.required_parameter_types]);

  const allAvailable = availability.length > 0 && availability.every((a) => a.available);
  const someAvailable = availability.some((a) => a.available);

  // Build variable_mappings JSON
  const variableMappings = useMemo(() => {
    if (!allAvailable) return null;
    const mappings: Record<string, string> = {};
    for (const item of availability) {
      if (item.siteParam) {
        // Use the type name (lowercase, no spaces) as variable key
        mappings[item.typeName] = item.siteParam.id;
      }
    }
    return mappings;
  }, [availability, allAvailable]);

  const handleAssign = () => {
    if (!targetSiteId) return;

    // Find an existing global parameter for this derived definition
    // We need a parameter_type_id for the site_parameter
    // Use the first matching parameter or create one
    const derivedParamType = globalParams?.find(
      (p) => p.name === definition.name,
    );

    create(
      'site_parameters',
      {
        data: {
          site_id: targetSiteId,
          parameter_type_id: derivedParamType?.id ?? null,
          name: definition.display_name ?? definition.name,
          sensor_type: 'derived',
          display_units: definition.units,
          is_active: true,
          is_derived: true,
          derived_definition_id: definition.id,
          variable_mappings: variableMappings,
          sample_interval_sec: 600,
        },
      },
      {
        onSuccess: () => {
          notify('Derived parameter assigned to site', { type: 'success' });
          refresh();
          handleClose();
        },
        onError: (error) => {
          notify(
            `Failed to assign: ${error instanceof Error ? error.message : 'Unknown error'}`,
            { type: 'error' },
          );
        },
      },
    );
  };

  const handleClose = () => {
    setTargetSiteId('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign to Site: {definition.display_name ?? definition.name}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Formula: <code>{definition.formula}</code>
        </Typography>

        <TextField
          select
          label="Target Site"
          value={targetSiteId}
          onChange={(e) => setTargetSiteId(e.target.value)}
          fullWidth
          size="small"
        >
          {(sites ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>

        {/* Parameter availability check */}
        {targetSiteId && definition.required_parameter_types?.length > 0 && (
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Required Parameters
            </Typography>
            {availability.map((item) => (
              <Box
                key={item.typeName}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}
              >
                {item.available ? (
                  <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
                ) : (
                  <ErrorIcon sx={{ color: 'error.main', fontSize: 20 }} />
                )}
                <Typography variant="body2">
                  {item.typeName}
                </Typography>
                {item.siteParam && (
                  <Chip
                    label={item.siteParam.name}
                    size="small"
                    color="success"
                    variant="outlined"
                  />
                )}
                {!item.available && (
                  <Typography variant="caption" color="error">
                    Not configured at this site
                  </Typography>
                )}
              </Box>
            ))}

            {allAvailable && (
              <Alert severity="success" sx={{ mt: 1 }}>
                All required parameters are available. Ready to compute.
              </Alert>
            )}
            {!allAvailable && someAvailable && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Some parameters are missing. Derived values will be null until all
                required parameters are configured at this site.
              </Alert>
            )}
            {!someAvailable && availability.length > 0 && (
              <Alert severity="error" sx={{ mt: 1 }}>
                No required parameters found at this site. The derived parameter will
                produce null values.
              </Alert>
            )}
          </Box>
        )}

        {targetSiteId && (!definition.required_parameter_types || definition.required_parameter_types.length === 0) && (
          <Alert severity="info">
            This formula has no declared required parameter types.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleAssign}
          variant="contained"
          disabled={isPending || !targetSiteId}
          startIcon={isPending ? <CircularProgress size={16} /> : undefined}
        >
          Assign to Site
        </Button>
      </DialogActions>
    </Dialog>
  );
};
