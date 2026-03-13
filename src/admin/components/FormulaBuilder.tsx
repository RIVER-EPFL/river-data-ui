import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useInput, type InputProps } from 'react-admin';
import {
  Box,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';

const LazyVisualFormulaBuilder = lazy(() =>
  import('./VisualFormulaBuilder').then((mod) => ({
    default: mod.VisualFormulaBuilder,
  })),
);

const LazyFormulaPreviewChart = lazy(() =>
  import('./FormulaPreviewChart').then((mod) => ({
    default: mod.FormulaPreviewChart,
  })),
);

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

const MATH_FUNCTIONS = new Set([
  'sqrt', 'abs', 'ln', 'log', 'exp',
  'sin', 'cos', 'tan',
  'min', 'max',
  'pi', 'e',
]);

function findClosestMatch(unknown: string, known: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const lower = unknown.toLowerCase();

  for (const k of known) {
    const kLower = k.toLowerCase();
    if (kLower.includes(lower) || lower.includes(kLower)) return k;
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

  return null;
}

/* ------------------------------------------------------------------ */
/*  FormulaBuilder component                                          */
/* ------------------------------------------------------------------ */

export interface ParameterTypeInfo {
  name: string;
  display_name?: string;
  default_units?: string;
}

/** Wrapper that bridges string formula <-> FormulaNode AST for the visual builder */
const VisualFormulaWrapper: React.FC<{
  formulaText: string;
  onFormulaChange: (text: string) => void;
  parameterTypes: ParameterTypeInfo[];
}> = ({ formulaText, onFormulaChange, parameterTypes }) => {
  const [visualNode, setVisualNode] = useState<import('./VisualFormulaBuilder').FormulaNode | null>(null);
  const [hasEmpty, setHasEmpty] = useState(false);
  const parseRef = useRef<((f: string) => import('./VisualFormulaBuilder').FormulaNode | null) | null>(null);
  const serializeRef = useRef<((n: import('./VisualFormulaBuilder').FormulaNode) => string) | null>(null);
  const hasEmptySlotsRef = useRef<((n: import('./VisualFormulaBuilder').FormulaNode) => boolean) | null>(null);
  const lastSerializedRef = useRef<string>('');

  // Load parser/serializer on mount
  useEffect(() => {
    import('./VisualFormulaBuilder').then((mod) => {
      parseRef.current = mod.parseFromMeval;
      serializeRef.current = mod.serializeToMeval;
      hasEmptySlotsRef.current = mod.hasEmptySlots;
      if (formulaText.trim()) {
        setVisualNode(mod.parseFromMeval(formulaText));
        lastSerializedRef.current = formulaText;
      }
    });
  }, []);

  // Sync text -> visual only when formula changes externally (not from our own onChange)
  useEffect(() => {
    if (parseRef.current && formulaText !== lastSerializedRef.current) {
      if (formulaText.trim()) {
        setVisualNode(parseRef.current(formulaText));
      } else {
        setVisualNode(null);
      }
      lastSerializedRef.current = formulaText;
      setHasEmpty(false);
    }
  }, [formulaText]);

  const handleVisualChange = useCallback((node: import('./VisualFormulaBuilder').FormulaNode | null) => {
    setVisualNode(node);
    if (node && serializeRef.current && hasEmptySlotsRef.current) {
      if (hasEmptySlotsRef.current(node)) {
        // Has empty slots — block form submission but keep visual state
        lastSerializedRef.current = '';
        onFormulaChange('');
        setHasEmpty(true);
      } else {
        const text = serializeRef.current(node);
        lastSerializedRef.current = text;
        onFormulaChange(text);
        setHasEmpty(false);
      }
    } else if (!node) {
      lastSerializedRef.current = '';
      onFormulaChange('');
      setHasEmpty(false);
    }
  }, [onFormulaChange]);

  return (
    <>
      <LazyVisualFormulaBuilder
        value={visualNode}
        onChange={handleVisualChange}
        parameterTypes={parameterTypes}
      />
      {hasEmpty && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Formula has unfilled slots — fill all empty slots before saving
        </Alert>
      )}
    </>
  );
};

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

  const [validationError, setValidationError] = useState<string | null>(null);

  const formulaValue: string = field.value ?? '';

  // Extract used variables from formula
  const usedVars = (formulaValue.match(/\b[a-zA-Z_]\w*\b/g) ?? [])
    .filter((t) => !MATH_FUNCTIONS.has(t) && paramNames.includes(t));
  const uniqueUsedVars = [...new Set(usedVars)];

  // Validate whenever formula or parameterTypes change
  useEffect(() => {
    if (!formulaValue.trim()) {
      setValidationError(null);
      return;
    }
    setValidationError(validateFormula(formulaValue, paramNames));
  }, [formulaValue, paramNames.join(',')]);

  const hasError = !!fieldState.error || !!validationError;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, mb: 2, width: '100%' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="subtitle2">
          Formula Builder
          {isRequired && (
            <Typography component="span" color="error" sx={{ ml: 0.5 }}>
              *
            </Typography>
          )}
        </Typography>
      </Box>

      {/* Side-by-side layout: builder (left) + preview (right) */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {/* Left: Visual formula editor */}
        <Box sx={{ flex: '1 1 420px', minWidth: 0 }}>
          <Suspense fallback={<CircularProgress size={24} />}>
            <VisualFormulaWrapper
              formulaText={formulaValue}
              onFormulaChange={(newFormula: string) => field.onChange(newFormula)}
              parameterTypes={paramInfos}
            />
          </Suspense>

          {/* Validation error */}
          {hasError && (validationError || fieldState.error?.message) && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {validationError ?? fieldState.error?.message}
            </Alert>
          )}
        </Box>

        {/* Right: Preview chart */}
        <Box sx={{ flex: '1 1 400px', minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle2" gutterBottom>
              Preview
            </Typography>
            <Divider sx={{ mb: 1.5 }} />
            <Suspense fallback={<CircularProgress size={24} />}>
              <LazyFormulaPreviewChart
                formula={formulaValue}
                requiredVariables={uniqueUsedVars}
              />
            </Suspense>
          </Paper>
        </Box>
      </Box>
    </Paper>
  );
};

export default FormulaBuilder;
