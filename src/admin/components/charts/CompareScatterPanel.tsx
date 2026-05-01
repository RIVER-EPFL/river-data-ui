import { useState, useMemo } from 'react';
import { useGetList } from 'react-admin';
import { Box, Autocomplete, TextField, Typography, Alert } from '@mui/material';
import { ScatterPlot } from './ScatterPlot';

interface SiteRecord {
    id: string;
    name: string;
}

interface SiteParameterRecord {
    id: string;
    name: string;
    site_id: string;
    display_units: string | null;
    is_derived: boolean;
}

/**
 * Single-site X–Y scatter panel for the Compare page (US-6.4).
 * User picks a site → ScatterPlot lets them pick X/Y parameters from that site.
 */
export const CompareScatterPanel = () => {
    const [siteId, setSiteId] = useState<string | null>(null);

    const { data: sites } = useGetList<SiteRecord>(
        'sites',
        {
            pagination: { page: 1, perPage: 200 },
            sort: { field: 'name', order: 'ASC' },
        },
    );

    const { data: siteParams } = useGetList<SiteParameterRecord>(
        'site_parameters',
        {
            filter: { site_id: siteId, is_active: true },
            pagination: { page: 1, perPage: 200 },
            sort: { field: 'name', order: 'ASC' },
        },
        { enabled: !!siteId },
    );

    const parameters = useMemo(
        () =>
            (siteParams ?? [])
                .filter((p) => !p.is_derived)
                .map((p) => ({ id: p.id, name: p.name, units: p.display_units })),
        [siteParams],
    );

    return (
        <Box>
            <Box sx={{ mb: 2, maxWidth: 480 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Pick a site, then choose two parameters to plot against each other.
                </Typography>
                <Autocomplete
                    options={sites ?? []}
                    getOptionLabel={(option) => option.name}
                    value={(sites ?? []).find((s) => s.id === siteId) ?? null}
                    onChange={(_, value) => setSiteId(value?.id ?? null)}
                    renderInput={(params) => <TextField {...params} label="Site" />}
                />
            </Box>

            {!siteId && (
                <Alert severity="info">Select a site to view a scatter plot of paired parameters.</Alert>
            )}

            {siteId && parameters.length < 2 && (
                <Alert severity="warning">
                    This site has fewer than 2 non-derived parameters. Scatter plots need at least 2.
                </Alert>
            )}

            {siteId && parameters.length >= 2 && (
                <ScatterPlot siteId={siteId} parameters={parameters} />
            )}
        </Box>
    );
};
