import React, { useState, useCallback, useMemo } from 'react';
import {
    useNotify,
    useRefresh,
} from 'react-admin';
import {
    Box,
    Card,
    CardHeader,
    CardContent,
    Typography,
    Button,
    Chip,
    CircularProgress,
} from '@mui/material';
import FunctionsIcon from '@mui/icons-material/Functions';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import { useRiverDataProvider } from '../../useRiverDataProvider';
import type { ParameterRecord, SensorDeploymentRecord, LatestReading } from './SensorCard';

export interface DerivedParameterRecord {
    id: string;
    name: string;
    formula: string;
    display_name: string | null;
    units: string | null;
    description: string | null;
    sources: Array<{
        id: string;
        derived_definition_id: string;
        parameter_id: string;
        variable_name: string;
    }>;
}

export interface DerivedSectionProps {
    derivedParams: ParameterRecord[];
    derivedDefs: Map<string, DerivedParameterRecord>;
    allSiteParams: ParameterRecord[];
    latestByParam: Map<string, LatestReading>;
    deployments: SensorDeploymentRecord[];
}

export const DerivedSection: React.FC<DerivedSectionProps> = ({
    derivedParams,
    derivedDefs,
    allSiteParams,
    latestByParam,
    deployments,
}) => {
    const dataProvider = useRiverDataProvider();
    const notify = useNotify();
    const refresh = useRefresh();
    const [recomputing, setRecomputing] = useState<string | null>(null);

    // Build lookup: parameter_id → site_parameter (non-derived only)
    const siteParamByParameterId = useMemo(() => {
        const map = new Map<string, ParameterRecord>();
        for (const sp of allSiteParams) {
            if (sp.is_derived) continue;
            map.set(sp.parameter_type_id, sp);
        }
        return map;
    }, [allSiteParams]);

    // Build lookup: parameter_id → has active deployment (deployed_until is null)
    const activeDeployByParamId = useMemo(() => {
        const set = new Set<string>();
        for (const d of deployments) {
            if (!d.deployed_until) {
                set.add(d.parameter_id);
            }
        }
        return set;
    }, [deployments]);

    const handleRecompute = useCallback(async (defId: string) => {
        setRecomputing(defId);
        try {
            await dataProvider.recomputeDerived(defId);
            notify('Recompute triggered', { type: 'success' });
            refresh();
        } catch {
            notify('Recompute failed', { type: 'error' });
        } finally {
            setRecomputing(null);
        }
    }, [dataProvider, notify, refresh]);

    if (derivedParams.length === 0) return null;

    return (
        <Card variant="outlined" sx={{ mt: 3 }}>
            <CardHeader
                avatar={<FunctionsIcon color="secondary" />}
                title="Derived Parameters"
            />
            <CardContent>
                {derivedParams.map((param) => {
                    const def = param.derived_definition_id
                        ? derivedDefs.get(param.derived_definition_id)
                        : undefined;

                    // Check source parameter availability and deployment status
                    const sources = def?.sources ?? [];
                    const availability = sources.map((source) => {
                        const siteParam = siteParamByParameterId.get(source.parameter_id);
                        if (!siteParam) {
                            return { variableName: source.variable_name, status: 'missing' as const };
                        }
                        const hasActiveDeploy = activeDeployByParamId.has(siteParam.id);
                        if (!hasActiveDeploy) {
                            return { variableName: source.variable_name, status: 'retired' as const };
                        }
                        return { variableName: source.variable_name, status: 'active' as const };
                    });
                    const allResolved = sources.length > 0 && availability.every((a) => a.status === 'active');

                    // Get latest reading for this derived parameter
                    const latest = latestByParam.get(param.id);

                    return (
                        <Box key={param.id} sx={{ mb: 2, pb: 2, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none', pb: 0 } }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography variant="body2" fontWeight="medium">
                                    {param.name}
                                </Typography>
                                {param.display_units && (
                                    <Chip label={param.display_units} size="small" variant="outlined" />
                                )}
                                {latest && (
                                    <Chip
                                        label={`${latest.value} (${new Date(latest.time).toLocaleString()})`}
                                        size="small"
                                        color="primary"
                                        variant="outlined"
                                    />
                                )}
                            </Box>

                            {def && (
                                <Typography
                                    variant="caption"
                                    component="div"
                                    sx={{ fontFamily: 'monospace', color: 'text.secondary', ml: 1, mb: 0.5 }}
                                >
                                    Formula: {def.formula}
                                </Typography>
                            )}

                            {/* Source parameter availability */}
                            {def && sources.length > 0 && (
                                <Box sx={{ ml: 1, mb: 0.5 }}>
                                    {availability.map((item) => (
                                        <Box
                                            key={item.variableName}
                                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mr: 2 }}
                                        >
                                            {item.status === 'active' && (
                                                <CheckCircleIcon sx={{ color: 'success.main', fontSize: 16 }} />
                                            )}
                                            {item.status === 'retired' && (
                                                <WarningAmberIcon sx={{ color: 'warning.main', fontSize: 16 }} />
                                            )}
                                            {item.status === 'missing' && (
                                                <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />
                                            )}
                                            <Typography variant="caption">
                                                {item.variableName}
                                            </Typography>
                                        </Box>
                                    ))}
                                </Box>
                            )}

                            {/* Warnings when source parameters are missing or retired */}
                            {availability.filter((a) => a.status === 'missing').length > 0 && (
                                <Typography variant="caption" color="error" sx={{ ml: 1, display: 'block' }}>
                                    Missing parameter: {availability.filter((a) => a.status === 'missing').map((m) => m.variableName).join(', ')}
                                </Typography>
                            )}
                            {availability.filter((a) => a.status === 'retired').length > 0 && (
                                <Typography variant="caption" sx={{ ml: 1, display: 'block', color: 'warning.main' }}>
                                    No data — required sensor for {availability.filter((a) => a.status === 'retired').map((m) => m.variableName).join(', ')} not deployed
                                </Typography>
                            )}

                            {def && (
                                <Box sx={{ ml: 1, mt: 0.5 }}>
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={
                                            recomputing === def.id ? (
                                                <CircularProgress size={14} />
                                            ) : (
                                                <FunctionsIcon />
                                            )
                                        }
                                        onClick={() => handleRecompute(def.id)}
                                        disabled={recomputing === def.id || !allResolved}
                                    >
                                        Recompute
                                    </Button>
                                </Box>
                            )}

                            {!def && param.derived_definition_id && (
                                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                    Definition not loaded
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </CardContent>
        </Card>
    );
};
