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
} from '@mui/material';

/* ------------------------------------------------------------------ */
/*  Client-side formula evaluation (preview only, not production math) */
/* ------------------------------------------------------------------ */

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
    // Replace math functions
    expr = expr.replace(/\bsqrt\b/g, 'Math.sqrt');
    expr = expr.replace(/\babs\b/g, 'Math.abs');
    expr = expr.replace(/\bln\b/g, 'Math.log');
    expr = expr.replace(/\blog\b/g, 'Math.log10');
    expr = expr.replace(/\bexp\b/g, 'Math.exp');
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

function validateFormula(
  formula: string,
  knownVars: string[],
): string | null {
  if (!formula.trim()) return null;

  const mathFunctions = new Set([
    'sqrt', 'abs', 'ln', 'log', 'exp',
  ]);
  const knownSet = new Set(knownVars);

  // Extract all word tokens from the formula
  const tokens = formula.match(/\b[a-zA-Z_]\w*\b/g) ?? [];
  const unknown = tokens.filter(
    (t) => !mathFunctions.has(t) && !knownSet.has(t),
  );

  if (unknown.length > 0) {
    const unique = [...new Set(unknown)];
    return `Unknown variable${unique.length > 1 ? 's' : ''}: ${unique.join(', ')}`;
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
/*  Operator definitions                                              */
/* ------------------------------------------------------------------ */

interface Operator {
  label: string;
  insert: string;
  tooltip: string;
}

const OPERATORS: Operator[] = [
  { label: '+', insert: ' + ', tooltip: 'Addition' },
  { label: '-', insert: ' - ', tooltip: 'Subtraction' },
  { label: '*', insert: ' * ', tooltip: 'Multiplication' },
  { label: '/', insert: ' / ', tooltip: 'Division' },
  { label: '^', insert: '^', tooltip: 'Power' },
  { label: 'log', insert: 'log(', tooltip: 'Base-10 logarithm' },
  { label: 'ln', insert: 'ln(', tooltip: 'Natural logarithm' },
  { label: 'exp', insert: 'exp(', tooltip: 'Exponential (e^x)' },
  { label: 'sqrt', insert: 'sqrt(', tooltip: 'Square root' },
  { label: 'abs', insert: 'abs(', tooltip: 'Absolute value' },
];

/* ------------------------------------------------------------------ */
/*  FormulaBuilder component                                          */
/* ------------------------------------------------------------------ */

export interface FormulaBuilderProps extends InputProps {
  /** Available parameter type names that can be used as variables */
  parameterTypes?: string[];
}

export const FormulaBuilder: React.FC<FormulaBuilderProps> = (props) => {
  const { parameterTypes = [], ...rest } = props;

  const {
    field,
    fieldState,
    isRequired,
  } = useInput({ ...rest, source: rest.source });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const formulaValue: string = field.value ?? '';

  // Re-validate and re-evaluate whenever formula or parameterTypes change
  useEffect(() => {
    if (!formulaValue.trim()) {
      setPreview('');
      setValidationError(null);
      return;
    }

    const error = validateFormula(formulaValue, parameterTypes);
    setValidationError(error);

    if (!error) {
      const sampleVars = Object.fromEntries(
        parameterTypes.map((v) => [v, 1.0]),
      );
      setPreview(evaluateFormula(formulaValue, sampleVars));
    } else {
      setPreview('');
    }
  }, [formulaValue, parameterTypes]);

  // Insert text at cursor position
  const insertAtCursor = useCallback(
    (text: string) => {
      const el = inputRef.current;
      const pos = el ? el.selectionStart ?? formulaValue.length : formulaValue.length;
      const before = formulaValue.slice(0, pos);
      const after = formulaValue.slice(pos);
      const newValue = before + text + after;
      field.onChange(newValue);
      // Restore cursor after React re-render
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

  const hasError = !!fieldState.error || !!validationError;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 2, width: '100%', maxWidth: 600 }}
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
      {parameterTypes.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Variables (click to insert)
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {parameterTypes.map((pt) => (
              <Chip
                key={pt}
                label={pt}
                size="small"
                color="primary"
                variant="outlined"
                onClick={() => insertAtCursor(pt)}
                clickable
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Operator bar */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Operators
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {OPERATORS.map((op) => (
            <Tooltip key={op.label} title={op.tooltip} arrow>
              <Button
                size="small"
                variant="outlined"
                onClick={() => insertAtCursor(op.insert)}
                sx={{
                  minWidth: 0,
                  px: 1,
                  py: 0.25,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  textTransform: 'none',
                }}
              >
                {op.label}
              </Button>
            </Tooltip>
          ))}
        </Stack>
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

      {/* Live preview */}
      {formulaValue.trim() && !validationError && (
        <Alert severity="info" sx={{ mb: 0 }}>
          <Typography variant="body2">
            <strong>Preview</strong> (all variables = 1.0):{' '}
            <code>{String(preview)}</code>
          </Typography>
        </Alert>
      )}
    </Paper>
  );
};

export default FormulaBuilder;
