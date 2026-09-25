import { describe, expect, it } from 'vitest';

import { crosses, headroom, routeLinks, type LinkEnds, type Rect, type Route } from './route';

const INPUTS: Rect = { left: 0, top: 170, right: 300, bottom: 400 };
const STEPS: Rect = { left: 396, top: 170, right: 696, bottom: 360 };
const OUTPUTS: Rect = { left: 792, top: 170, right: 1092, bottom: 300 };
const THREE = [INPUTS, STEPS, OUTPUTS];
// The two-column wrap: Outputs under Inputs.
const WRAPPED = [INPUTS, STEPS, { left: 0, top: 424, right: 300, bottom: 500 }];

function link(key: string, from: [number, number], to: [number, number]): LinkEnds {
	return {
		key,
		label: key,
		from: { table: from[0], y: from[1] },
		to: { table: to[0], y: to[1] },
	};
}

function segments(route: Route): Array<[[number, number], [number, number]]> {
	return route.points.slice(1).map((p, i) => [route.points[i]!, p]);
}

function throughATable(routes: Route[], tables: Rect[]): string[] {
	return routes
		.filter((r) => segments(r).some(([a, b]) => tables.some((t) => crosses(a, b, t))))
		.map((r) => r.key);
}

/** The x of every vertical run, by link. */
function verticals(route: Route): number[] {
	return segments(route)
		.filter(([a, b]) => a[0] === b[0])
		.map(([a]) => a[0]);
}

describe('routeLinks', () => {
	it('crosses the gutter straight into the next table', () => {
		const [route] = routeLinks(THREE, 1092, [link('c_const', [0, 380], [1, 300])]);
		// 300 + 10
		expect(route!.points).toEqual([
			[300, 380],
			[310, 380],
			[310, 300],
			[396, 300],
		]);
		expect(route!.label).toMatchObject({
			text: 'c_const',
			x: 303,
			y: 377,
			anchor: 'start',
		});
	});

	it('goes over the tables when one lies between', () => {
		const routes = routeLinks(THREE, 1092, [link('vol_sa', [0, 300], [2, 190])]);
		expect(throughATable(routes, THREE)).toEqual([]);
		const top = Math.min(...routes[0]!.points.map(([, y]) => y));
		expect(top).toBeLessThan(170);
		expect(routes[0]!.points.at(-1)).toEqual([792, 190]);
		expect(routes[0]!.label.y).toBe(top - 3);
	});

	it('gives each link its own lane and each label its own place', () => {
		const links = [
			link('lab_co2', [0, 250], [2, 190]),
			link('vol_sa', [0, 280], [2, 190]),
			link('vol_water', [0, 310], [2, 190]),
			link('lab_pa', [1, 230], [2, 190]),
			link('lab_temp_k', [1, 190], [2, 190]),
		];
		const routes = routeLinks(THREE, 1092, links);
		expect(throughATable(routes, THREE)).toEqual([]);
		const xs = routes.flatMap(verticals);
		expect(new Set(xs).size).toBe(xs.length);
		const labels = routes.map((r) => `${r.label.x},${r.label.y}`);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('labels the links of one source at the rows they reach', () => {
		const routes = routeLinks(THREE, 1092, [
			{ ...link('kh', [1, 330], [2, 190]), labelAt: 'to' },
			{ ...link('kh', [1, 330], [2, 250]), labelAt: 'to' },
		]);
		// 792 - 3, beside the Outputs rows
		expect(routes.map((r) => [r.label.x, r.label.y, r.label.anchor])).toEqual([
			[789, 187, 'end'],
			[789, 247, 'end'],
		]);
	});

	it('joins two rows of one table by a bracket on its right', () => {
		const [route] = routeLinks(THREE, 1092, [link('water_k', [1, 280], [1, 330])]);
		expect(route!.points).toEqual([
			[696, 280],
			[706, 280],
			[706, 330],
			[696, 330],
		]);
	});

	it('brackets on the left when the table has no gutter on its right', () => {
		const [route] = routeLinks(WRAPPED, 696, [link('water_k', [1, 280], [1, 330])]);
		expect(route!.points).toEqual([
			[396, 280],
			[386, 280],
			[386, 330],
			[396, 330],
		]);
	});

	it('routes down the gutter into a table wrapped under the first', () => {
		const routes = routeLinks(WRAPPED, 696, [
			link('lab_co2', [0, 250], [2, 450]),
			link('lab_pa', [1, 230], [2, 450]),
		]);
		expect(throughATable(routes, WRAPPED)).toEqual([]);
		expect(routes.every((r) => r.points.every(([x]) => x >= 0 && x <= 696))).toBe(true);
		expect(routes.map((r) => r.points.at(-1))).toEqual([
			[300, 450],
			[300, 450],
		]);
	});

	it('draws nothing for no links', () => {
		expect(routeLinks(THREE, 1092, [])).toEqual([]);
	});
});

describe('headroom', () => {
	it('is none when every link crosses a gutter', () => {
		expect(headroom(routeLinks(THREE, 1092, [link('c_const', [0, 380], [1, 300])]))).toBe(0);
		expect(headroom([])).toBe(0);
	});

	it('holds each lane over the tables with its label', () => {
		const links = [
			link('lab_co2', [0, 250], [2, 190]),
			link('vol_sa', [0, 280], [2, 190]),
			link('vol_water', [0, 310], [2, 190]),
		];
		// 10 + 3 * 20
		expect(headroom(routeLinks(THREE, 1092, links))).toBe(70);
		const shifted = THREE.map((t) => ({ ...t, top: t.top - 100, bottom: t.bottom - 100 }));
		const moved = links.map((l) => ({
			...l,
			from: { ...l.from, y: l.from.y - 100 },
			to: { ...l.to, y: l.to.y - 100 },
		}));
		const routes = routeLinks(shifted, 1092, moved);
		// The highest label's baseline stays a lane's height below the top of the surface.
		expect(Math.min(...routes.map((r) => r.label.y))).toBeGreaterThanOrEqual(17);
	});
});
