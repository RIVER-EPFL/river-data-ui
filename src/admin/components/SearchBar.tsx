import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataProvider } from 'react-admin';
import {
  TextField,
  InputAdornment,
  Paper,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Typography,
  CircularProgress,
  Popper,
  ClickAwayListener,
  Box,
  Fade,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PlaceIcon from '@mui/icons-material/Place';
import SensorsIcon from '@mui/icons-material/Sensors';
import ScienceIcon from '@mui/icons-material/Science';
import FolderIcon from '@mui/icons-material/Folder';
import type { RiverDataProvider, SearchResponse } from '../dataProvider';

type CategoryKey = keyof SearchResponse['results'];

const categories: Array<{ key: CategoryKey; label: string; icon: React.ReactElement; path: string }> = [
  { key: 'sites', label: 'Sites', icon: <PlaceIcon fontSize="small" />, path: 'sites' },
  { key: 'sensors', label: 'Sensors', icon: <SensorsIcon fontSize="small" />, path: 'sensors' },
  { key: 'parameters', label: 'Parameters', icon: <ScienceIcon fontSize="small" />, path: 'parameters' },
  { key: 'projects', label: 'Projects', icon: <FolderIcon fontSize="small" />, path: 'projects' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getResultLabel = (category: string, item: any): string => {
  if (category === 'sensors') {
    return [item.serial_number, item.name].filter(Boolean).join(' \u2014 ') || item.id;
  }
  if (category === 'parameters') {
    return item.display_name && item.display_name !== item.name
      ? `${item.name} (${item.display_name})`
      : item.name || item.id;
  }
  return item.name || item.id;
};

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const dataProvider = useDataProvider<RiverDataProvider>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K to focus
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Debounced search
  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (q.trim().length < 2) {
        setResults(null);
        setOpen(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          const { data } = await dataProvider.search(q.trim());
          setResults(data);
          setOpen(data.total > 0);
        } catch {
          setResults(null);
          setOpen(false);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [dataProvider],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    doSearch(v);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleSelect = (path: string, id: string) => {
    setOpen(false);
    setQuery('');
    setResults(null);
    navigate(`/admin/${path}/${id}/show`);
  };

  const showNoResults = !loading && query.trim().length >= 2 && results?.total === 0;

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchorRef} sx={{ position: 'relative', mx: 2 }}>
        <TextField
          inputRef={inputRef}
          size="small"
          placeholder="Search..."
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results && results.total > 0) setOpen(true);
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'rgba(255,255,255,0.7)' }} />
                </InputAdornment>
              ),
              endAdornment: loading ? (
                <InputAdornment position="end">
                  <CircularProgress size={16} sx={{ color: 'rgba(255,255,255,0.7)' }} />
                </InputAdornment>
              ) : (
                <InputAdornment position="end">
                  <Typography
                    variant="caption"
                    sx={{
                      border: '1px solid rgba(255,255,255,0.3)',
                      borderRadius: 0.5,
                      px: 0.5,
                      fontSize: '0.65rem',
                      color: 'rgba(255,255,255,0.5)',
                      lineHeight: 1.6,
                    }}
                  >
                    Ctrl+K
                  </Typography>
                </InputAdornment>
              ),
            },
          }}
          sx={{
            width: 280,
            '& .MuiOutlinedInput-root': {
              color: 'white',
              '& fieldset': { borderColor: 'rgba(255,255,255,0.3)' },
              '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.5)' },
              '&.Mui-focused fieldset': { borderColor: 'rgba(255,255,255,0.7)' },
            },
            '& .MuiInputBase-input::placeholder': {
              color: 'rgba(255,255,255,0.5)',
              opacity: 1,
            },
          }}
        />
        <Popper
          open={open || showNoResults}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          transition
          style={{ zIndex: 1300 }}
        >
          {({ TransitionProps }) => (
            <Fade {...TransitionProps} timeout={150}>
              <Paper
                elevation={8}
                sx={{ width: 360, maxHeight: 420, overflow: 'auto', mt: 0.5 }}
              >
                {showNoResults ? (
                  <Typography sx={{ p: 2, color: 'text.secondary' }}>
                    No results for "{query.trim()}"
                  </Typography>
                ) : (
                  <List dense disablePadding>
                    {categories.map(({ key, label, icon, path }) => {
                      const items = results?.results[key];
                      if (!items || items.length === 0) return null;
                      return (
                        <li key={key}>
                          <ListSubheader
                            sx={{
                              lineHeight: '32px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.08em',
                            }}
                          >
                            {label}
                          </ListSubheader>
                          {items.map((item) => (
                            <ListItemButton
                              key={item.id}
                              onClick={() => handleSelect(path, item.id)}
                              sx={{ pl: 3 }}
                            >
                              <Box sx={{ mr: 1, display: 'flex', color: 'text.secondary' }}>
                                {icon}
                              </Box>
                              <ListItemText
                                primary={getResultLabel(key, item)}
                                primaryTypographyProps={{ noWrap: true, fontSize: '0.875rem' }}
                              />
                            </ListItemButton>
                          ))}
                        </li>
                      );
                    })}
                  </List>
                )}
              </Paper>
            </Fade>
          )}
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
