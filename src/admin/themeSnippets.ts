import type { SxProps, Theme } from '@mui/material/styles';
import { tokens } from './theme';

export const snippets = {
  tightCardRow: {
    py: 0.75,
    px: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    flexWrap: 'wrap',
    borderBottom: '1px solid',
    borderColor: 'divider',
    '&:last-of-type': { borderBottom: 'none' },
  } as SxProps<Theme>,

  statBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0.25,
    minWidth: 100,
  } as SxProps<Theme>,

  monoInline: {
    fontFamily: tokens.font.mono,
    fontSize: '0.8125rem',
    color: 'text.primary',
  } as SxProps<Theme>,

  sectionHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 1,
    mb: 1.5,
    pb: 0.5,
    borderBottom: '1px solid',
    borderColor: 'divider',
  } as SxProps<Theme>,

  navSectionLabel: {
    px: 2,
    pt: 2,
    pb: 0.5,
    fontSize: '0.7rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: 'text.secondary',
  } as SxProps<Theme>,

  stickyChart: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    backgroundColor: 'background.paper',
    pb: 1,
    borderBottom: '1px solid',
    borderColor: 'divider',
  } as SxProps<Theme>,
};
