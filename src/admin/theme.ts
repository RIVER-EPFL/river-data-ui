import { defaultTheme } from 'react-admin';

const BRAND = {
  primary: '#1F4E79',
  primaryDk: '#16314A',
  accent: '#C77700',
  accentDk: '#9E5F00',
  surface: '#FFFFFF',
  bg: '#F7F8FA',
  divider: '#E2E5EA',
  text: '#1B2330',
  textMuted: '#5A6472',
};

const SEVERITY = {
  ok: { main: '#2E7D32', soft: 'rgba(46,125,50,0.10)', border: 'rgba(46,125,50,0.45)' },
  warning: { main: '#B26A00', soft: 'rgba(178,106,0,0.12)', border: 'rgba(178,106,0,0.55)' },
  alarm: { main: '#C62828', soft: 'rgba(198,40,40,0.12)', border: 'rgba(198,40,40,0.65)' },
  unknown: { main: '#90A4AE', soft: 'rgba(144,164,174,0.10)', border: 'rgba(144,164,174,0.40)' },
};

const DATA_VIZ = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#56B4E9',
  '#E69F00',
  '#F0E442',
  '#000000',
];

const MARKERS = {
  grabSample: { fill: '#FFB74D', stroke: '#E65100' },
  flagged: { stroke: '#D32F2F' },
  annotationDefault: 'rgba(158,158,158,0.18)',
};

const FONT = {
  body: '"Inter","Roboto","Helvetica Neue",system-ui,sans-serif',
  mono: '"JetBrains Mono","SF Mono","Roboto Mono","Menlo",monospace',
};

const DENSITY = {
  rowY: 6,
  cardGap: 12,
  sectionGap: 24,
  pageGutter: 16,
};

export const tokens = {
  brand: BRAND,
  severity: SEVERITY,
  dataViz: DATA_VIZ,
  markers: MARKERS,
  font: FONT,
  density: DENSITY,
};

export const theme = {
  ...defaultTheme,
  palette: {
    mode: 'light' as const,
    primary: { main: BRAND.primary, dark: BRAND.primaryDk, contrastText: '#FFF' },
    secondary: { main: BRAND.accent, dark: BRAND.accentDk, contrastText: '#FFF' },
    success: { main: SEVERITY.ok.main },
    warning: { main: SEVERITY.warning.main },
    error: { main: SEVERITY.alarm.main },
    info: { main: '#0288D1' },
    background: { default: BRAND.bg, paper: BRAND.surface },
    divider: BRAND.divider,
    text: { primary: BRAND.text, secondary: BRAND.textMuted },
  },
  typography: {
    fontFamily: FONT.body,
    h1: { fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.25 },
    h2: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3 },
    h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35 },
    h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
    h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 700,
      lineHeight: 1.4,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.06em',
    },
    subtitle1: { fontSize: '0.95rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.875rem', lineHeight: 1.5 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.45 },
    caption: { fontSize: '0.75rem', lineHeight: 1.4 },
    button: {
      fontSize: '0.8125rem',
      fontWeight: 600,
      textTransform: 'none' as const,
      letterSpacing: 0,
    },
  },
  shape: { borderRadius: 6 },
  spacing: 8,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: BRAND.bg },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' as const },
      styleOverrides: {
        root: { borderColor: BRAND.divider, boxShadow: 'none' },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: { paddingBottom: 4 },
        title: { fontSize: '0.95rem', fontWeight: 600 },
        subheader: { fontSize: '0.75rem' },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          paddingTop: 8,
          paddingBottom: 8,
          '&:last-child': { paddingBottom: 12 },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' as const },
      styleOverrides: {
        root: { borderRadius: 6, paddingInline: 12 },
        sizeSmall: { paddingBlock: 4, fontSize: '0.8125rem' },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' as const },
    },
    MuiChip: {
      defaultProps: { size: 'small' as const },
      styleOverrides: {
        root: { fontWeight: 500, height: 22 },
        sizeSmall: { fontSize: '0.7rem' },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' as const, variant: 'outlined' as const },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: BRAND.surface },
        input: { fontSize: '0.875rem' },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: '0.875rem' } },
    },
    MuiSelect: { defaultProps: { size: 'small' as const } },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontSize: '0.875rem',
          fontWeight: 500,
          minHeight: 40,
          '&.Mui-selected': { fontWeight: 600 },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40, borderBottom: `1px solid ${BRAND.divider}` },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 8 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '1.0625rem', fontWeight: 600, paddingBlock: 14 } },
    },
    MuiDialogContent: {
      styleOverrides: { root: { paddingTop: 8 } },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: '12px 16px' } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: '0.8125rem', paddingBlock: 8 },
        head: { fontWeight: 600, color: BRAND.text, backgroundColor: BRAND.bg },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontSize: '0.75rem', backgroundColor: 'rgba(20,30,50,0.92)' },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: BRAND.divider } },
    },
  },
  sidebar: { width: 232, closedWidth: 56 },
};
