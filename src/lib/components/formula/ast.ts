export type FormulaNode =
	| { type: 'variable'; name: string }
	| { type: 'constant'; value: number }
	| { type: 'binary'; op: string; left: FormulaNode; right: FormulaNode }
	| { type: 'function'; name: string; args: FormulaNode[] }
	| { type: 'empty' };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

export function serializeToMeval(node: FormulaNode): string {
	switch (node.type) {
		case 'variable': return node.name;
		case 'constant': return String(node.value);
		case 'empty': return '?';
		case 'function': return `${node.name}(${node.args.map(serializeToMeval).join(', ')})`;
		case 'binary': {
			const l = serializeToMeval(node.left);
			const r = serializeToMeval(node.right);
			const lWrap = node.left.type === 'binary' && PRECEDENCE[node.left.op] < PRECEDENCE[node.op];
			const rWrap = node.right.type === 'binary' && PRECEDENCE[node.right.op] <= PRECEDENCE[node.op];
			return `${lWrap ? `(${l})` : l} ${node.op} ${rWrap ? `(${r})` : r}`;
		}
	}
}

export function parseFromMeval(expr: string): FormulaNode {
	const s = expr.trim();
	if (!s) return { type: 'empty' };
	return parseExpr(s, 0).node;
}

/**
 * The text the expression does not reach, or an empty string when it reaches all of it.
 *
 * The parser stops at the first thing it cannot continue with and hands the remainder back, so
 * `a b` reads as `a` with `b` left over. That leftover is what the server refuses as a parse
 * error, known here without asking it.
 */
export function unparsed(expr: string): string {
	const s = expr.trim();
	if (!s) return '';
	return parseExpr(s, 0).rest.trim();
}

function parseExpr(s: string, minPrec: number): { node: FormulaNode; rest: string } {
	let { node, rest } = parseAtom(s);
	rest = rest.trimStart();

	while (rest.length > 0) {
		const op = rest[0];
		const prec = PRECEDENCE[op];
		if (prec === undefined || prec < minPrec) break;
		rest = rest.slice(1).trimStart();
		const rhs = parseExpr(rest, prec + 1);
		node = { type: 'binary', op, left: node, right: rhs.node };
		rest = rhs.rest.trimStart();
	}
	return { node, rest };
}

function parseAtom(s: string): { node: FormulaNode; rest: string } {
	s = s.trimStart();

	if (s[0] === '(') {
		const inner = parseExpr(s.slice(1), 0);
		const rest = inner.rest.trimStart();
		return { node: inner.node, rest: rest[0] === ')' ? rest.slice(1) : rest };
	}

	if (s[0] === '-' && (s.length === 1 || !'0123456789'.includes(s[1]))) {
		const inner = parseAtom(s.slice(1));
		return {
			node: { type: 'binary', op: '*', left: { type: 'constant', value: -1 }, right: inner.node },
			rest: inner.rest,
		};
	}

	const numMatch = s.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
	if (numMatch) {
		return { node: { type: 'constant', value: Number(numMatch[0]) }, rest: s.slice(numMatch[0].length) };
	}

	const fnMatch = s.match(/^([a-zA-Z_]\w*)\s*\(/);
	if (fnMatch) {
		const name = fnMatch[1];
		let rest = s.slice(fnMatch[0].length);
		const args: FormulaNode[] = [];
		while (rest.length > 0 && rest[0] !== ')') {
			const before = rest;
			if (args.length > 0) {
				rest = rest.trimStart();
				if (rest[0] === ',') rest = rest.slice(1);
			}
			const arg = parseExpr(rest, 0);
			args.push(arg.node);
			rest = arg.rest.trimStart();
			// A pass that consumed nothing cannot consume anything on the next one either, and
			// the caller parses on every keystroke.
			if (rest === before) break;
		}
		if (rest[0] === ')') rest = rest.slice(1);
		return { node: { type: 'function', name, args }, rest };
	}

	const varMatch = s.match(/^[a-zA-Z_]\w*/);
	if (varMatch) {
		return { node: { type: 'variable', name: varMatch[0] }, rest: s.slice(varMatch[0].length) };
	}

	return { node: { type: 'empty' }, rest: s };
}

export function getNodeAtPath(root: FormulaNode, path: string): FormulaNode | null {
	if (path === 'root') return root;
	const parts = path.replace('root.', '').split('.');
	let node: FormulaNode = root;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (node.type === 'binary' && (part === 'left' || part === 'right')) {
			node = part === 'left' ? node.left : node.right;
		} else if (node.type === 'function' && part === 'args') {
			const idx = Number(parts[++i]);
			if (!Number.isInteger(idx) || !node.args[idx]) return null;
			node = node.args[idx];
		} else return null;
	}
	return node;
}

export function replaceAtPath(root: FormulaNode, path: string, replacement: FormulaNode): FormulaNode {
	if (path === 'root') return replacement;
	const parts = path.replace('root.', '').split('.');
	return replaceRecursive(root, parts, replacement);
}

function replaceRecursive(node: FormulaNode, parts: string[], replacement: FormulaNode): FormulaNode {
	if (parts.length === 0) return replacement;
	const [head, ...tail] = parts;

	if (node.type === 'binary') {
		if (head === 'left') return { ...node, left: replaceRecursive(node.left, tail, replacement) };
		if (head === 'right') return { ...node, right: replaceRecursive(node.right, tail, replacement) };
	}
	// `args` names the child list; the segment after it is the index into it.
	if (node.type === 'function' && head === 'args') {
		const idx = Number(tail[0]);
		if (Number.isInteger(idx) && node.args[idx]) {
			const args = [...node.args];
			args[idx] = replaceRecursive(args[idx], tail.slice(1), replacement);
			return { ...node, args };
		}
	}
	return node;
}

export function hasEmptySlots(node: FormulaNode): boolean {
	if (node.type === 'empty') return true;
	if (node.type === 'binary') return hasEmptySlots(node.left) || hasEmptySlots(node.right);
	if (node.type === 'function') return node.args.some(hasEmptySlots);
	return false;
}

export function wrapWithOp(node: FormulaNode, op: string): FormulaNode {
	return { type: 'binary', op, left: node, right: { type: 'empty' } };
}

/** What the palette hands the builder when a term is dropped or clicked. */
export type DragPayload =
	| { kind: 'variable'; name: string }
	| { kind: 'constant'; name: string }
	| { kind: 'function'; name: string }
	| { kind: 'operator'; op: string };

const MULTI_ARG_FUNCTIONS = new Set(['min', 'max']);

/**
 * The node a dropped palette term becomes. A named constant is an identifier, the same as a
 * parameter: the API resolves an identifier against the catalog and then against the constants
 * table, so the name has to reach the formula verbatim. `{type: 'constant'}` is a typed number,
 * which is a different thing and is what the inline editor produces.
 */
export function payloadToNode(payload: DragPayload, existing?: FormulaNode | null): FormulaNode {
	switch (payload.kind) {
		case 'variable':
		case 'constant':
			return { type: 'variable', name: payload.name };
		case 'function': {
			const argCount = MULTI_ARG_FUNCTIONS.has(payload.name) ? 2 : 1;
			const firstArg = existing && existing.type !== 'empty' ? existing : { type: 'empty' as const };
			const rest: FormulaNode[] = Array(argCount - 1).fill({ type: 'empty' });
			return { type: 'function', name: payload.name, args: [firstArg, ...rest] };
		}
		case 'operator':
			if (existing && existing.type !== 'empty') return wrapWithOp(existing, payload.op);
			return { type: 'binary', op: payload.op, left: { type: 'empty' }, right: { type: 'empty' } };
	}
}
