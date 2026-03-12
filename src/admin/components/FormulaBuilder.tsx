import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useInput, type InputProps } from 'react-admin';
import {
  Box,
  Chip,
  TextField,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  Tooltip,
  Divider,
  Collapse,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

/* ------------------------------------------------------------------ */
/*  Client-side formula evaluation (preview only, not production math) */
/* ------------------------------------------------------------------ */

const MATH_FUNCTIONS = new Set([
  'sqrt', 'abs', 'ln', 'log', 'exp',
  'sin', 'cos', 'tan',
  'min', 'max',
  'pi', 'e',
]);

function evaluateFormula(
  formula: string,
  variables: Record<string, number>,
): number | string {
  try {
    let expr = formula;
    // Replace variable names with values (longest-first to avoid partial matches)
    const sorted = Object.entries(variables).sort(
      ([a], [b]) => b.length - a.length,
    );
    for (const [name, value] of sorted) {
      expr = expr.replace(new RegExp(`\\b${name}\\b`, 'g'), String(value));
    }
    // Replace constants
    expr = expr.replace(/\bpi\b/g, String(Math.PI));
    expr = expr.replace(/\be\b/g, String(Math.E));
    // Replace math functions
    expr = expr.replace(/\bsqrt\b/g, 'Math.sqrt');
    expr = expr.replace(/\babs\b/g, 'Math.abs');
    expr = expr.replace(/\bln\b/g, 'Math.log');
    expr = expr.replace(/\blog\b/g, 'Math.log10');
    expr = expr.replace(/\bexp\b/g, 'Math.exp');
    expr = expr.replace(/\bsin\b/g, 'Math.sin');
    expr = expr.replace(/\bcos\b/g, 'Math.cos');
    expr = expr.replace(/\btan\b/g, 'Math.tan');
    expr = expr.replace(/\bmin\b/g, 'Math.min');
    expr = expr.replace(/\bmax\b/g, 'Math.max');
    expr = expr.replace(/\^/g, '**');
    // Safely evaluate
    const fn = new Function('return ' + expr);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) return 'Invalid result';
    return result;
  } catch (e) {
    return String(e instanceof Error ? e.message : e);
  }
}

/* ------------------------------------------------------------------ */
/*  Validation: check for unknown identifiers                         */
/* ------------------------------------------------------------------ */

function findClosestMatch(unknown: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = unknown.toLowerCase();

  for (const k of known) {
    const kLower = k.toLowerCase();
    // Simple substring check first
    if (kLower.includes(lower) || lower.includes(kLower)) return k;
    // Levenshtein-ish: just check edit distance for short strings
    if (Math.abs(k.length - unknown.length) <= 2) {
      let dist = 0;
      const minLen = Math.min(k.length, unknown.length);
      for (let i = 0; i < minLen; i++) {
        if (kLower[i] !== lower[i]) dist++;
      }
      dist += Math.abs(k.length - unknown.length);
      if (dist < bestDist && dist <= 3) {
        bestDist = dist;
        best = k;
      }
    }
  }
  return best;
}

function validateFormula(
  formula: string,
  knownVars: string[],
): string | null {
  if (!formula.trim()) return null;

  const knownSet = new Set(knownVars);

  // Extract all word tokens from the formula
  const tokens = formula.match(/\b[a-zA-Z_]\w*\b/g) ?? [];
  const unknown = tokens.filter(
    (t) => !MATH_FUNCTIONS.has(t) && !knownSet.has(t),
  );

  if (unknown.length > 0) {
    const unique = [...new Set(unknown)];
    const suggestions = unique.map((u) => {
      const match = findClosestMatch(u, knownVars);
      return match ? `'${u}' (did you mean '${match}'?)` : `'${u}'`;
    });
    return `Unknown variable${unique.length > 1 ? 's' : ''}: ${suggestions.join(', ')}`;
  }

  // Try a quick parse to detect syntax errors
  const result = evaluateFormula(
    formula,
    Object.fromEntries(knownVars.map((v) => [v, 1])),
  );
  if (typeof result === 'string') {
    return result;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Function reference definitions                                    */
/* ------------------------------------------------------------------ */

interface FunctionRef {
  label: string;
  insert: string;
  description: string;
}

const FUNCTION_GROUPS: Array<{ category: string; items: FunctionRef[] }> = [
  {
    category: 'Arithmetic',
    items: [
      { label: '+', insert: ' + ', description: 'Addition' },
      { label: '-', insert: ' - ', description: 'Subtraction' },
      { label: '*', insert: ' * ', description: 'Multiplication' },
      { label: '/', insert: ' / ', description: 'Division' },
      { label: '^', insert: '^', description: 'Power (e.g. x^2)' },
    ],
  },
  {
    category: 'Functions',
    items: [
      { label: 'sqrt', insert: 'sqrt(', description: 'Square root' },
      { label: 'abs', insert: 'abs(', description: 'Absolute value' },
      { label: 'exp', insert: 'exp(', description: 'e raised to x' },
      { label: 'ln', insert: 'ln(', description: 'Natural logarithm (base e)' },
      { label: 'log', insert: 'log(', description: 'Common logarithm (base 10)' },
      { label: 'sin', insert: 'sin(', description: 'Sine (radians)' },
      { label: 'cos', insert: 'cos(', description: 'Cosine (radians)' },
      { label: 'tan', insert: 'tan(', description: 'Tangent (radians)' },
      { label: 'min', insert: 'min(', description: 'Minimum of two values' },
      { label: 'max', insert: 'max(', description: 'Maximum of two values' },
    ],
  },
  {
    category: 'Constants',
    items: [
      { label: 'pi', insert: 'pi', description: '3.14159...' },
      { label: 'e', insert: 'e', description: '2.71828...' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  FormulaBuilder component                                          */
/* ------------------------------------------------------------------ */

export interface ParameterTypeInfo {
  name: string;
  display_name?: string;
  default_units?: string;
}

export interface FormulaBuilderProps extends InputProps {
  /** Available parameter types that can be used as variables */
  parameterTypes?: Array<string | ParameterTypeInfo>;
}

export const FormulaBuilder: React.FC<FormulaBuilderProps> = (props) => {
  const { parameterTypes = [], ...rest } = props;

  // Normalize to ParameterTypeInfo[]
  const paramInfos: ParameterTypeInfo[] = parameterTypes.map((pt) =>
    typeof pt === 'string' ? { name: pt } : pt,
  );
  const paramNames = paramInfos.map((p) => p.name);

  const {
    field,
    fieldState,
    isRequired,
  } = useInput({ ...rest, source: rest.source });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showFunctions, setShowFunctions] = useState(false);
  const [sampleValues, setSampleValues] = useState<Record<string, number>>({});

  const formulaValue: string = field.value ?? '';

  // Extract used variables from formula
  const usedVars = (formulaValue.match(/\b[a-zA-Z_]\w*\b/g) ?? [])
    .filter((t) => !MATH_FUNCTIONS.has(t) && paramNames.includes(t));
  const uniqueUsedVars = [...new Set(usedVars)];

  // Initialize sample values for new variables
  useEffect(() => {
    setSampleValues((prev) => {
      const next = { ...prev };
      for (const v of uniqueUsedVars) {
        if (!(v in next)) next[v] = 1.0;
      }
      return next;
    });
  }, [formulaValue]);

  // Re-validate and re-evaluate whenever formula or parameterTypes change
  useEffect(() => {
    if (!formulaValue.trim()) {
      setPreview('');
      setValidationError(null);
      return;
    }

    const error = validateFormula(formulaValue, paramNames);
    setValidationError(error);

    if (!error) {
      const vars = Object.fromEntries(
        paramNames.map((v) => [v, sampleValues[v] ?? 1.0]),
      );
      setPreview(evaluateFormula(formulaValue, vars));
    } else {
      setPreview('');
    }
  }, [formulaValue, paramNames.join(','), sampleValues]);

  // Insert text at cursor position
  const insertAtCursor = useCallback(
    (text: string) => {
      const el = inputRef.current;
      const pos = el ? el.selectionStart ?? formulaValue.length : formulaValue.length;
      const before = formulaValue.slice(0, pos);
      const after = formulaValue.slice(pos);
      const newValue = before + text + after;
      field.onChange(newValue);
      const newPos = pos + text.length;
      setCursorPos(newPos);
    },
    [formulaValue, field],
  );

  // Restore cursor position after value change
  useEffect(() => {
    if (cursorPos !== null && inputRef.current) {
      inputRef.current.selectionStart = cursorPos;
      inputRef.current.selectionEnd = cursorPos;
      inputRef.current.focus();
      setCursorPos(null);
    }
  }, [cursorPos, formulaValue]);

  const handleSampleValueChange = (varName: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setSampleValues((prev) => ({ ...prev, [varName]: num }));
    }
  };

  const hasError = !!fieldState.error || !!validationError;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 2, width: '100%', maxWidth: 700 }}
    >
      <Typography variant="subtitle2" gutterBottom>
        Formula Builder
        {isRequired && (
          <Typography component="span" color="error" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      {/* Variable palette */}
      {paramInfos.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Variables (click to insert)
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {paramInfos.map((pt) => (
              <Tooltip
                key={pt.name}
                title={
                  pt.display_name || pt.default_units
                    ? `${pt.display_name ?? pt.name}${pt.default_units ? ` (${pt.default_units})` : ''}`
                    : pt.name
                }
                arrow
              >
                <Chip
                  label={pt.name}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onClick={() => insertAtCursor(pt.name)}
                  clickable
                />
              </Tooltip>
            ))}
          </Stack>
        </Box>
      )}

      {/* Function reference panel */}
      <Box sx={{ mb: 1.5 }}>
        <Button
          size="small"
          onClick={() => setShowFunctions(!showFunctions)}
          endIcon={showFunctions ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ textTransform: 'none', mb: 0.5 }}
        >
          Functions & Operators
        </Button>
        <Collapse in={showFunctions}>
          {FUNCTION_GROUPS.map((group) => (
            <Box key={group.category} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary" fontWeight="bold" sx={{ display: 'block', mb: 0.5 }}>
                {group.category}
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                {group.items.map((fn) => (
                  <Tooltip key={fn.label} title={fn.description} arrow>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => insertAtCursor(fn.insert)}
                      sx={{
                        minWidth: 0,
                        px: 1,
                        py: 0.25,
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        textTransform: 'none',
                      }}
                    >
                      {fn.label}
                    </Button>
                  </Tooltip>
                ))}
              </Stack>
            </Box>
          ))}
        </Collapse>
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      {/* Formula text area */}
      <TextField
        inputRef={inputRef}
        label="Formula"
        value={formulaValue}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        multiline
        minRows={2}
        maxRows={6}
        fullWidth
        required={isRequired}
        error={hasError}
        helperText={
          fieldState.error?.message ??
          'Math expression using variable names and operators above'
        }
        slotProps={{
          input: {
            sx: { fontFamily: 'monospace', fontSize: '0.9rem' },
          },
        }}
        sx={{ mb: 1.5 }}
      />

      {/* Validation error */}
      {validationError && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {validationError}
        </Alert>
      )}

      {/* Live preview with editable sample values */}
      {formulaValue.trim() && !validationError && (
        <Box sx={{ mb: 0 }}>
          {uniqueUsedVars.length > 0 && (
            <Table size="small" sx={{ mb: 1, maxWidth: 400 }}>
              <TableBody>
                {uniqueUsedVars.map((varName) => {
                  const info = paramInfos.find((p) => p.name === varName);
                  return (
                    <TableRow key={varName}>
                      <TableCell sx={{ border: 0, py: 0.5, pl: 0, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {varName}
                      </TableCell>
                      <TableCell sx={{ border: 0, py: 0.5, width: 100 }}>
                        <TextField
                          size="small"
                          type="number"
                          value={sampleValues[varName] ?? 1}
                          onChange={(e) => handleSampleValueChange(varName, e.target.value)}
                          inputProps={{ step: 'any' }}
                          sx={{ width: 100 }}
                        />
                      </TableCell>
                      <TableCell sx={{ border: 0, py: 0.5, color: 'text.secondary', fontSize: '0.8rem' }}>
                        {info?.default_units ?? ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <Alert severity="info" sx={{ mb: 0 }}>
            <Typography variant="body2">
              <strong>Result</strong>:{' '}
              <code>{typeof preview === 'number' ? preview.toFixed(6).replace(/\.?0+$/, '') : String(preview)}</code>
            </Typography>
          </Alert>
        </Box>
      )}
    </Paper>
  );
};

export default FormulaBuilder;
