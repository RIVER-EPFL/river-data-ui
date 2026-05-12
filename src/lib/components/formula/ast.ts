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
			if (args.length > 0) {
				rest = rest.trimStart();
				if (rest[0] === ',') rest = rest.slice(1);
			}
			const arg = parseExpr(rest, 0);
			args.push(arg.node);
			rest = arg.rest.trimStart();
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
	for (const part of parts) {
		if (node.type === 'binary') {
			if (part === 'left') node = node.left;
			else if (part === 'right') node = node.right;
			else return null;
		} else if (node.type === 'function') {
			const idx = parseInt(part.replace('args.', ''));
			if (!isNaN(idx) && node.args[idx]) node = node.args[idx];
			else return null;
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
	if (node.type === 'function') {
		const idx = parseInt(head.replace('args.', ''));
		if (!isNaN(idx)) {
			const args = [...node.args];
			args[idx] = replaceRecursive(args[idx], tail, replacement);
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
