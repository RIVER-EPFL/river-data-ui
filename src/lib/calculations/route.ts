// Links between the sheet's tables, routed around them: out of a table's edge into the gutter
// beside it, over the tables through the headroom when one lies between, and into the reader's
// table from its gutter. Every lane is a line of its own, so two links never share a segment.

/** A table's box, in the coordinates of the surface the tables are laid out on. */
export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** A link to draw: from a row of one table to a row of another, or of the same one. */
export interface LinkEnds {
	key: string;
	label: string;
	from: { table: number; y: number };
	to: { table: number; y: number };
	/** Which end a link across the gutter is labelled at; one over the tables is labelled there. */
	labelAt?: 'from' | 'to';
}

export interface Route {
	key: string;
	/** Whether it runs through a lane over the tables. */
	over: boolean;
	points: Array<[number, number]>;
	path: string;
	label: {
		text: string;
		x: number;
		y: number;
		anchor: 'start' | 'middle' | 'end';
	};
}

type Side = 'left' | 'right';

interface Candidate {
	over: boolean;
	exit: Side;
	entry: Side;
}

/** Distance from a table's edge to its first lane. */
const PAD = 10;
/** Distance between two lanes in one gutter. */
const STEP = 8;
/** Distance between two lanes over the tables, room for a label on each. */
const LANE = 20;

const CANDIDATES: Candidate[] = [false, true].flatMap((over) =>
	(['right', 'left'] as const).flatMap((exit) =>
		(['left', 'right'] as const).map((entry) => ({ over, exit, entry })),
	),
);

/** Whether a horizontal or vertical segment passes through the inside of a table. */
export function crosses(a: [number, number], b: [number, number], r: Rect): boolean {
	const e = 0.5;
	const [left, right] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
	const [top, bottom] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
	return right > r.left + e && left < r.right - e && bottom > r.top + e && top < r.bottom - e;
}

function edge(r: Rect, side: Side): number {
	return side === 'left' ? r.left : r.right;
}

/** The lane `index` lanes out from a table's side. */
function lane(r: Rect, side: Side, index: number): number {
	const out = PAD + index * STEP;
	return side === 'left' ? r.left - out : r.right + out;
}

function withoutRepeats(points: Array<[number, number]>): Array<[number, number]> {
	return points.filter(
		(p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
	);
}

/** One way to draw a link, or null when it heads back across the reader's table. */
function draw(
	link: LinkEnds,
	a: Rect,
	b: Rect,
	c: Candidate,
	sx: number,
	tx: number,
	hy: number,
): Pick<Route, 'points' | 'label'> | null {
	const x1 = edge(a, c.exit);
	const x2 = edge(b, c.entry);
	const { y: y1 } = link.from;
	const { y: y2 } = link.to;
	if (c.over) {
		return {
			points: [
				[x1, y1],
				[sx, y1],
				[sx, hy],
				[tx, hy],
				[tx, y2],
				[x2, y2],
			],
			label: {
				text: link.label,
				x: (sx + tx) / 2,
				y: hy - 3,
				anchor: 'middle',
			},
		};
	}
	if (c.entry === 'left' ? sx >= x2 : sx <= x2) return null;
	const points: Array<[number, number]> = [
		[x1, y1],
		[sx, y1],
		[sx, y2],
		[x2, y2],
	];
	// Beside the row the label names, outside its table.
	const [x, y, rightward] =
		link.labelAt === 'to' ? [x2, y2, c.entry === 'right'] : [x1, y1, c.exit === 'right'];
	return {
		points,
		label: {
			text: link.label,
			x: rightward ? x + 3 : x - 3,
			y: y - 3,
			anchor: rightward ? 'start' : 'end',
		},
	};
}

function fits(points: Array<[number, number]>, tables: Rect[], width: number): boolean {
	if (points.some(([x]) => x < 0 || x > width)) return false;
	return points.every((p, i) => i === 0 || tables.every((t) => !crosses(points[i - 1]!, p, t)));
}

/**
 * Orthogonal routes for the links, none through a table and none outside `[0, width]`. A link
 * goes straight across the gutter when nothing lies in its way, else over the tables. Two rows
 * of one table are joined by a bracket on one side of it. A link no route clears goes over the
 * tables regardless.
 */
export function routeLinks(tables: Rect[], width: number, links: LinkEnds[]): Route[] {
	const used = new Map<string, number>();
	const take = (table: number, side: Side, commit: boolean) => {
		const key = `${table}:${side}`;
		const index = used.get(key) ?? 0;
		if (commit) used.set(key, index + 1);
		return lane(tables[table]!, side, index);
	};
	const top = Math.min(...tables.map((t) => t.top));
	let over = 0;
	return links.map((link) => {
		const a = tables[link.from.table]!;
		const b = tables[link.to.table]!;
		const hy = top - PAD - over * LANE;
		const tried = (c: Candidate) =>
			draw(
				link,
				a,
				b,
				c,
				take(link.from.table, c.exit, false),
				take(link.to.table, c.entry, false),
				hy,
			);
		const c =
			CANDIDATES.find((c) => {
				const drawn = tried(c);
				return drawn !== null && fits(drawn.points, tables, width);
			}) ?? CANDIDATES.find((c) => c.over)!;
		const sx = take(link.from.table, c.exit, true);
		const tx = c.over ? take(link.to.table, c.entry, true) : 0;
		if (c.over) over += 1;
		const { points, label } = draw(link, a, b, c, sx, tx, hy)!;
		const kept = withoutRepeats(points);
		const path = kept.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
		return { key: link.key, over: c.over, points: kept, path, label };
	});
}

/** Room above the tables for the routes' lanes over them, none when every link crosses a gutter. */
export function headroom(routes: Route[]): number {
	const over = routes.filter((r) => r.over).length;
	return over === 0 ? 0 : PAD + over * LANE;
}
