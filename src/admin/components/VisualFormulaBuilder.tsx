import React, { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Chip,
  Button,
  TextField,
  Paper,
  IconButton,
  Typography,
  Tooltip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { ParameterTypeInfo } from './FormulaBuilder';

/* ------------------------------------------------------------------ */
/*  AST Types                                                          */
/* ------------------------------------------------------------------ */

export type FormulaNode =
  | { type: 'Variable'; name: string }
  | { type: 'Constant'; value: number }
  | { type: 'BinaryOp'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaNode; right: FormulaNode }
  | { type: 'FunctionCall'; name: string; args: FormulaNode[] };

/* ------------------------------------------------------------------ */
/*  Serialization: AST -> meval string                                 */
/* ------------------------------------------------------------------ */

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

export function serializeToMeval(node: FormulaNode): string {
  switch (node.type) {
    case 'Variable':
      return node.name;
    case 'Constant':
      return node.value < 0 ? `(${node.value})` : String(node.value);
    case 'BinaryOp': {
      const leftStr = serializeChild(node.left, node.op, 'left');
      const rightStr = serializeChild(node.right, node.op, 'right');
      return `${leftStr} ${node.op} ${rightStr}`;
    }
    case 'FunctionCall':
      return `${node.name}(${node.args.map(serializeToMeval).join(', ')})`;
  }
}

function serializeChild(child: FormulaNode, parentOp: string, side: 'left' | 'right'): string {
  const s = serializeToMeval(child);
  if (child.type !== 'BinaryOp') return s;
  const childPrec = PRECEDENCE[child.op] ?? 0;
  const parentPrec = PRECEDENCE[parentOp] ?? 0;
  // Parenthesize if child has lower precedence, or same precedence on right side
  // for left-associative ops, or same precedence for right-associative ^
  const needsParens =
    childPrec < parentPrec ||
    (childPrec === parentPrec && side === 'right' && parentOp !== '^') ||
    (childPrec === parentPrec && side === 'left' && parentOp === '^');
  return needsParens ? `(${s})` : s;
}

/* ------------------------------------------------------------------ */
/*  Parsing: meval string -> AST (recursive descent)                   */
/* ------------------------------------------------------------------ */

const KNOWN_FUNCTIONS = new Set([
  'sqrt', 'abs', 'ln', 'log', 'exp',
  'sin', 'cos', 'tan',
  'min', 'max',
]);

const KNOWN_CONSTANTS = new Set(['pi', 'e']);

class Parser {
  private pos = 0;
  constructor(private input: string) {}

  parse(): FormulaNode | null {
    this.skipWhitespace();
    if (this.pos >= this.input.length) return null;
    const node = this.parseAddSub();
    this.skipWhitespace();
    if (this.pos < this.input.length) return null; // leftover input
    return node;
  }

  private parseAddSub(): FormulaNode {
    let left = this.parseMulDiv();
    this.skipWhitespace();
    while (this.pos < this.input.length && (this.peek() === '+' || this.peek() === '-')) {
      const op = this.advance() as '+' | '-';
      this.skipWhitespace();
      const right = this.parseMulDiv();
      left = { type: 'BinaryOp', op, left, right };
      this.skipWhitespace();
    }
    return left;
  }

  private parseMulDiv(): FormulaNode {
    let left = this.parseExponent();
    this.skipWhitespace();
    while (this.pos < this.input.length && (this.peek() === '*' || this.peek() === '/')) {
      const op = this.advance() as '*' | '/';
      this.skipWhitespace();
      const right = this.parseExponent();
      left = { type: 'BinaryOp', op, left, right };
      this.skipWhitespace();
    }
    return left;
  }

  private parseExponent(): FormulaNode {
    const base = this.parseUnary();
    this.skipWhitespace();
    if (this.pos < this.input.length && this.peek() === '^') {
      this.advance();
      this.skipWhitespace();
      const exp = this.parseExponent(); // right-associative
      return { type: 'BinaryOp', op: '^', left: base, right: exp };
    }
    return base;
  }

  private parseUnary(): FormulaNode {
    this.skipWhitespace();
    if (this.peek() === '-') {
      this.advance();
      this.skipWhitespace();
      const operand = this.parseUnary();
      // Optimize: -constant -> negative constant
      if (operand.type === 'Constant') {
        return { type: 'Constant', value: -operand.value };
      }
      return {
        type: 'BinaryOp',
        op: '-',
        left: { type: 'Constant', value: 0 },
        right: operand,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    this.skipWhitespace();

    // Parenthesized expression
    if (this.peek() === '(') {
      this.advance();
      this.skipWhitespace();
      const expr = this.parseAddSub();
      this.skipWhitespace();
      this.expect(')');
      return expr;
    }

    // Number
    if (this.isDigitOrDot()) {
      return this.parseNumber();
    }

    // Identifier: function call, constant, or variable
    if (this.isIdentStart()) {
      const ident = this.parseIdentifier();

      // Known constants -> treat as variables (meval handles them)
      if (KNOWN_CONSTANTS.has(ident)) {
        return { type: 'Variable', name: ident };
      }

      this.skipWhitespace();
      // Function call
      if (this.peek() === '(') {
        this.advance();
        this.skipWhitespace();
        const args: FormulaNode[] = [];
        if (this.peek() !== ')') {
          args.push(this.parseAddSub());
          this.skipWhitespace();
          while (this.peek() === ',') {
            this.advance();
            this.skipWhitespace();
            args.push(this.parseAddSub());
            this.skipWhitespace();
          }
        }
        this.expect(')');
        return { type: 'FunctionCall', name: ident, args };
      }

      // Variable
      return { type: 'Variable', name: ident };
    }

    throw new Error(`Unexpected character '${this.peek()}' at position ${this.pos}`);
  }

  private parseNumber(): FormulaNode {
    const start = this.pos;
    while (this.pos < this.input.length && (this.isDigitAt(this.pos) || this.input[this.pos] === '.')) {
      this.pos++;
    }
    const numStr = this.input.slice(start, this.pos);
    const value = parseFloat(numStr);
    if (isNaN(value)) throw new Error(`Invalid number: ${numStr}`);
    return { type: 'Constant', value };
  }

  private parseIdentifier(): string {
    const start = this.pos;
    while (this.pos < this.input.length && this.isIdentChar(this.input[this.pos])) {
      this.pos++;
    }
    return this.input.slice(start, this.pos);
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private peek(): string {
    return this.input[this.pos] ?? '';
  }

  private advance(): string {
    return this.input[this.pos++];
  }

  private expect(ch: string) {
    if (this.peek() !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}, got '${this.peek()}'`);
    }
    this.advance();
  }

  private isDigitOrDot(): boolean {
    const ch = this.peek();
    return (ch >= '0' && ch <= '9') || ch === '.';
  }

  private isDigitAt(pos: number): boolean {
    const ch = this.input[pos];
    return ch >= '0' && ch <= '9';
  }

  private isIdentStart(): boolean {
    const ch = this.peek();
    return /[a-zA-Z_]/.test(ch);
  }

  private isIdentChar(ch: string): boolean {
    return /[a-zA-Z0-9_]/.test(ch);
  }
}

export function parseFromMeval(formula: string): FormulaNode | null {
  const trimmed = formula.trim();
  if (!trimmed) return null;
  try {
    const parser = new Parser(trimmed);
    return parser.parse();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Unique path-based node IDs                                         */
/* ------------------------------------------------------------------ */

type NodePath = string; // e.g. "root", "root.left", "root.right", "root.args.0"

/* ------------------------------------------------------------------ */
/*  Visual Editor Component                                            */
/* ------------------------------------------------------------------ */

const VARIABLE_COLORS = [
  '#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00',
  '#0097a7', '#5d4037', '#c2185b', '#303f9f', '#689f38',
];

const MATH_FUNCTIONS = ['sqrt', 'abs', 'ln', 'log', 'exp', 'sin', 'cos', 'tan', 'min', 'max'];
const OPERATORS: Array<'+' | '-' | '*' | '/' | '^'> = ['+', '-', '*', '/', '^'];
const MULTI_ARG_FUNCTIONS = new Set(['min', 'max']);

interface VisualFormulaBuilderProps {
  value: FormulaNode | null;
  onChange: (node: FormulaNode | null) => void;
  parameterTypes: ParameterTypeInfo[];
}

export const VisualFormulaBuilder: React.FC<VisualFormulaBuilderProps> = ({
  value,
  onChange,
  parameterTypes,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<NodePath | null>(null);

  // Assign stable colors to parameter types
  const paramColorMap = useMemo(() => {
    const map = new Map<string, string>();
    parameterTypes.forEach((pt, i) => {
      map.set(pt.name, VARIABLE_COLORS[i % VARIABLE_COLORS.length]);
    });
    return map;
  }, [parameterTypes]);

  // Replace a node at a given path
  const replaceAtPath = useCallback(
    (root: FormulaNode | null, path: NodePath, newNode: FormulaNode | null): FormulaNode | null => {
      if (path === 'root') return newNode;
      if (!root) return null;

      const parts = path.split('.');
      // parts[0] is always 'root'
      return replaceRecursive(root, parts, 1, newNode);
    },
    [],
  );

  // Insert a node at the selected slot (or at root if no slot selected)
  const insertNode = useCallback(
    (node: FormulaNode) => {
      if (selectedSlot) {
        const updated = replaceAtPath(value, selectedSlot, node);
        onChange(updated);
        setSelectedSlot(null);
      } else if (!value) {
        onChange(node);
      }
    },
    [selectedSlot, value, onChange, replaceAtPath],
  );

  // Wrap the selected node (or root) in a BinaryOp
  const wrapWithOperator = useCallback(
    (op: '+' | '-' | '*' | '/' | '^') => {
      if (selectedSlot && selectedSlot !== 'root') {
        const existingNode = getNodeAtPath(value, selectedSlot);
        if (existingNode) {
          const wrapped: FormulaNode = {
            type: 'BinaryOp',
            op,
            left: existingNode,
            right: { type: 'Constant', value: 0 },
          };
          const updated = replaceAtPath(value, selectedSlot, wrapped);
          onChange(updated);
          setSelectedSlot(selectedSlot + '.right');
          return;
        }
      }
      // Wrap root
      if (value) {
        const wrapped: FormulaNode = {
          type: 'BinaryOp',
          op,
          left: value,
          right: { type: 'Constant', value: 0 },
        };
        onChange(wrapped);
        setSelectedSlot('root.right');
      }
    },
    [selectedSlot, value, onChange, replaceAtPath],
  );

  // Insert a variable
  const handleVariableClick = useCallback(
    (name: string) => {
      insertNode({ type: 'Variable', name });
    },
    [insertNode],
  );

  // Insert a function
  const handleFunctionClick = useCallback(
    (funcName: string) => {
      const argCount = MULTI_ARG_FUNCTIONS.has(funcName) ? 2 : 1;
      const args: FormulaNode[] = [];
      for (let i = 0; i < argCount; i++) {
        args.push({ type: 'Constant', value: 0 });
      }
      insertNode({ type: 'FunctionCall', name: funcName, args });
    },
    [insertNode],
  );

  // Delete a node at path
  const handleDelete = useCallback(
    (path: NodePath) => {
      if (path === 'root') {
        onChange(null);
        setSelectedSlot(null);
      } else {
        const updated = replaceAtPath(value, path, null);
        onChange(updated);
        if (selectedSlot === path) setSelectedSlot(null);
      }
    },
    [value, onChange, replaceAtPath, selectedSlot],
  );

  // Update a constant value
  const handleConstantChange = useCallback(
    (path: NodePath, newValue: number) => {
      const updated = replaceAtPath(value, path, { type: 'Constant', value: newValue });
      onChange(updated);
    },
    [value, onChange, replaceAtPath],
  );

  return (
    <Paper variant="outlined" sx={{ p: 2, width: '100%', maxWidth: 700 }}>
      <Typography variant="subtitle2" gutterBottom>
        Visual Formula Builder
      </Typography>

      {/* Variable palette */}
      {parameterTypes.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Variables (click to insert)
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {parameterTypes.map((pt) => (
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
                  clickable
                  onClick={() => handleVariableClick(pt.name)}
                  sx={{
                    backgroundColor: paramColorMap.get(pt.name) ?? '#757575',
                    color: '#fff',
                    fontFamily: 'monospace',
                    '&:hover': {
                      backgroundColor: paramColorMap.get(pt.name) ?? '#757575',
                      filter: 'brightness(0.85)',
                    },
                  }}
                />
              </Tooltip>
            ))}
          </Box>
        </Box>
      )}

      {/* Function palette */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Functions
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {MATH_FUNCTIONS.map((fn) => (
            <Button
              key={fn}
              size="small"
              variant="outlined"
              onClick={() => handleFunctionClick(fn)}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                textTransform: 'none',
              }}
            >
              {fn}()
            </Button>
          ))}
        </Box>
      </Box>

      {/* Operator buttons */}
      <Box sx={{ mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Operators (wraps selected node)
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {OPERATORS.map((op) => (
            <Button
              key={op}
              size="small"
              variant="outlined"
              onClick={() => wrapWithOperator(op)}
              disabled={!value}
              sx={{
                minWidth: 36,
                px: 1,
                py: 0.25,
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                fontWeight: 'bold',
              }}
            >
              {op}
            </Button>
          ))}
        </Box>
      </Box>

      {/* Tree rendering */}
      <Box
        sx={{
          mt: 1,
          p: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          backgroundColor: 'grey.50',
          minHeight: 60,
        }}
      >
        {value ? (
          <NodeRenderer
            node={value}
            path="root"
            selectedSlot={selectedSlot}
            onSelectSlot={setSelectedSlot}
            onDelete={handleDelete}
            onConstantChange={handleConstantChange}
            paramColorMap={paramColorMap}
          />
        ) : (
          <DropZone
            path="root"
            selected={selectedSlot === 'root'}
            onClick={() => setSelectedSlot('root')}
            label="Click a variable or function to start"
          />
        )}
      </Box>

      {/* Serialized output preview */}
      {value && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Formula:{' '}
            <Typography component="code" variant="caption" sx={{ fontFamily: 'monospace' }}>
              {serializeToMeval(value)}
            </Typography>
          </Typography>
        </Box>
      )}
    </Paper>
  );
};

/* ------------------------------------------------------------------ */
/*  Drop Zone                                                          */
/* ------------------------------------------------------------------ */

interface DropZoneProps {
  path: NodePath;
  selected: boolean;
  onClick: () => void;
  label?: string;
}

const DropZone: React.FC<DropZoneProps> = ({ selected, onClick, label }) => (
  <Box
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 80,
      minHeight: 32,
      px: 1,
      border: '2px dashed',
      borderColor: selected ? 'primary.main' : 'grey.400',
      borderRadius: 1,
      backgroundColor: selected ? 'primary.50' : 'transparent',
      cursor: 'pointer',
      transition: 'all 0.15s',
      '&:hover': {
        borderColor: 'primary.main',
        backgroundColor: 'action.hover',
      },
    }}
  >
    <Typography variant="caption" color="text.secondary" sx={{ userSelect: 'none' }}>
      {label ?? 'Drop here'}
    </Typography>
  </Box>
);

/* ------------------------------------------------------------------ */
/*  Node Renderer                                                      */
/* ------------------------------------------------------------------ */

interface NodeRendererProps {
  node: FormulaNode;
  path: NodePath;
  selectedSlot: NodePath | null;
  onSelectSlot: (path: NodePath | null) => void;
  onDelete: (path: NodePath) => void;
  onConstantChange: (path: NodePath, value: number) => void;
  paramColorMap: Map<string, string>;
}

const NodeRenderer: React.FC<NodeRendererProps> = ({
  node,
  path,
  selectedSlot,
  onSelectSlot,
  onDelete,
  onConstantChange,
  paramColorMap,
}) => {
  const deleteButton = (
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation();
        onDelete(path);
      }}
      sx={{ ml: 0.25, p: 0.25, opacity: 0.6, '&:hover': { opacity: 1 } }}
    >
      <CloseIcon sx={{ fontSize: 14 }} />
    </IconButton>
  );

  switch (node.type) {
    case 'Variable': {
      const color = paramColorMap.get(node.name) ?? '#757575';
      return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
          <Chip
            label={node.name}
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onSelectSlot(path);
            }}
            sx={{
              backgroundColor: color,
              color: '#fff',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              border: selectedSlot === path ? '2px solid' : 'none',
              borderColor: 'primary.dark',
            }}
          />
          {deleteButton}
        </Box>
      );
    }

    case 'Constant': {
      return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
          <TextField
            size="small"
            type="number"
            value={node.value}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onConstantChange(path, v);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectSlot(path);
            }}
            inputProps={{ step: 'any' }}
            sx={{
              width: 80,
              '& .MuiInputBase-input': {
                py: 0.5,
                px: 1,
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              },
              border: selectedSlot === path ? '2px solid' : 'none',
              borderColor: 'primary.main',
              borderRadius: 1,
            }}
          />
          {deleteButton}
        </Box>
      );
    }

    case 'BinaryOp': {
      return (
        <Box
          onClick={(e) => {
            e.stopPropagation();
            onSelectSlot(path);
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.5,
            border: '1px solid',
            borderColor: selectedSlot === path ? 'primary.main' : 'grey.300',
            borderRadius: 1,
            backgroundColor: '#fff',
          }}
        >
          {/* Left operand */}
          <NodeOrSlot
            node={node.left}
            path={`${path}.left`}
            selectedSlot={selectedSlot}
            onSelectSlot={onSelectSlot}
            onDelete={onDelete}
            onConstantChange={onConstantChange}
            paramColorMap={paramColorMap}
          />

          {/* Operator */}
          <Typography
            component="span"
            sx={{
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: '1rem',
              px: 0.5,
              color: 'text.primary',
            }}
          >
            {node.op}
          </Typography>

          {/* Right operand */}
          <NodeOrSlot
            node={node.right}
            path={`${path}.right`}
            selectedSlot={selectedSlot}
            onSelectSlot={onSelectSlot}
            onDelete={onDelete}
            onConstantChange={onConstantChange}
            paramColorMap={paramColorMap}
          />

          {deleteButton}
        </Box>
      );
    }

    case 'FunctionCall': {
      return (
        <Box
          onClick={(e) => {
            e.stopPropagation();
            onSelectSlot(path);
          }}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.25,
            px: 1,
            py: 0.5,
            border: '1px solid',
            borderColor: selectedSlot === path ? 'primary.main' : 'grey.300',
            borderRadius: 1,
            backgroundColor: '#fff',
          }}
        >
          <Typography
            component="span"
            sx={{
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: '0.9rem',
              color: 'secondary.main',
            }}
          >
            {node.name}(
          </Typography>

          {node.args.map((arg, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <Typography
                  component="span"
                  sx={{ fontFamily: 'monospace', color: 'text.secondary', mx: 0.25 }}
                >
                  ,
                </Typography>
              )}
              <NodeOrSlot
                node={arg}
                path={`${path}.args.${i}`}
                selectedSlot={selectedSlot}
                onSelectSlot={onSelectSlot}
                onDelete={onDelete}
                onConstantChange={onConstantChange}
                paramColorMap={paramColorMap}
              />
            </React.Fragment>
          ))}

          <Typography
            component="span"
            sx={{
              fontFamily: 'monospace',
              fontWeight: 'bold',
              fontSize: '0.9rem',
              color: 'secondary.main',
            }}
          >
            )
          </Typography>

          {deleteButton}
        </Box>
      );
    }
  }
};

/* ------------------------------------------------------------------ */
/*  NodeOrSlot: renders a node or a drop zone if null                   */
/* ------------------------------------------------------------------ */

interface NodeOrSlotProps {
  node: FormulaNode | null;
  path: NodePath;
  selectedSlot: NodePath | null;
  onSelectSlot: (path: NodePath | null) => void;
  onDelete: (path: NodePath) => void;
  onConstantChange: (path: NodePath, value: number) => void;
  paramColorMap: Map<string, string>;
}

const NodeOrSlot: React.FC<NodeOrSlotProps> = ({
  node,
  path,
  selectedSlot,
  onSelectSlot,
  onDelete,
  onConstantChange,
  paramColorMap,
}) => {
  if (!node) {
    return (
      <DropZone
        path={path}
        selected={selectedSlot === path}
        onClick={() => onSelectSlot(path)}
      />
    );
  }
  return (
    <NodeRenderer
      node={node}
      path={path}
      selectedSlot={selectedSlot}
      onSelectSlot={onSelectSlot}
      onDelete={onDelete}
      onConstantChange={onConstantChange}
      paramColorMap={paramColorMap}
    />
  );
};

/* ------------------------------------------------------------------ */
/*  Helper: navigate AST by path                                       */
/* ------------------------------------------------------------------ */

function getNodeAtPath(root: FormulaNode | null, path: NodePath): FormulaNode | null {
  if (!root) return null;
  if (path === 'root') return root;
  const parts = path.split('.');
  let current: FormulaNode | null = root;
  for (let i = 1; i < parts.length; i++) {
    if (!current) return null;
    const part = parts[i];
    if (part === 'left' && current.type === 'BinaryOp') {
      current = current.left;
    } else if (part === 'right' && current.type === 'BinaryOp') {
      current = current.right;
    } else if (part === 'args' && current.type === 'FunctionCall') {
      const idx = parseInt(parts[++i], 10);
      current = current.args[idx] ?? null;
    } else {
      return null;
    }
  }
  return current;
}

function replaceRecursive(
  node: FormulaNode,
  parts: string[],
  depth: number,
  newNode: FormulaNode | null,
): FormulaNode | null {
  const part = parts[depth];

  if (node.type === 'BinaryOp') {
    if (part === 'left') {
      if (depth === parts.length - 1) {
        if (!newNode) {
          // Replace deleted child with a constant placeholder
          return { ...node, left: { type: 'Constant', value: 0 } };
        }
        return { ...node, left: newNode };
      }
      const updatedLeft = replaceRecursive(node.left, parts, depth + 1, newNode);
      return updatedLeft !== null
        ? { ...node, left: updatedLeft }
        : { ...node, left: { type: 'Constant', value: 0 } };
    }
    if (part === 'right') {
      if (depth === parts.length - 1) {
        if (!newNode) {
          return { ...node, right: { type: 'Constant', value: 0 } };
        }
        return { ...node, right: newNode };
      }
      const updatedRight = replaceRecursive(node.right, parts, depth + 1, newNode);
      return updatedRight !== null
        ? { ...node, right: updatedRight }
        : { ...node, right: { type: 'Constant', value: 0 } };
    }
  }

  if (node.type === 'FunctionCall' && part === 'args') {
    const idx = parseInt(parts[depth + 1], 10);
    const newArgs = [...node.args];
    if (depth + 1 === parts.length - 1) {
      // Direct replacement of this arg
      newArgs[idx] = newNode ?? { type: 'Constant', value: 0 };
      return { ...node, args: newArgs };
    }
    const updatedArg = replaceRecursive(node.args[idx], parts, depth + 2, newNode);
    newArgs[idx] = updatedArg ?? { type: 'Constant', value: 0 };
    return { ...node, args: newArgs };
  }

  return node;
}

export default VisualFormulaBuilder;
