import { describe, expect, it } from 'vitest';

import type { EventCell } from '$api/service';
import { cellCurves, visitCellCurveMark } from './curve';

interface Curve {
	id: string;
	name: string | null;
	sensor_id: string;
	slope: number;
	intercept: number;
	retired_at: string | null;
}

const curve: Curve = {
	id: 'c0ffee00-0000-4000-8000-000000000001',
	name: 'plate 7',
	sensor_id: 'toc-1',
	slope: 1.05,
	intercept: -2,
	retired_at: null,
};

function cellWith(
	curves: Array<Curve | null>,
	tool: string | null = null,
): Pick<EventCell, 'record' | 'tool'> {
	return {
		tool,
		record: {
			readings: curves.map((standard_curve, replicate_index) => ({
				replicate_index,
				raw_value: 120,
				standard_curve,
			})),
		},
	} as unknown as Pick<EventCell, 'record' | 'tool'>;
}

describe('cellCurves', () => {
	it('opens a curve a calculation applied on that calculation', () => {
		const [named] = cellCurves(cellWith([curve, curve], 'doc'), '/admin');
		expect(named).toEqual({
			id: curve.id,
			label: 'plate 7',
			equation: 'y = 1.05x - 2',
			retired: false,
			target: { kind: 'calculation', tool: 'doc' },
		});
	});

	it('opens a curve applied outside a calculation on its instrument', () => {
		const curves = cellCurves(cellWith([curve]), '/admin');
		expect(curves).toHaveLength(1);
		expect(curves[0]!.target).toEqual({
			kind: 'instrument',
			href: `/admin/sensors/toc-1?tab=curves&curve=${curve.id}`,
		});
	});

	it('names nothing for a value no curve corrected', () => {
		expect(cellCurves(cellWith([null, null]), '/admin')).toEqual([]);
		expect(cellCurves({ tool: null, record: null } as never, '/admin')).toEqual([]);
	});

	it('names each distinct curve once, in replicate order', () => {
		const other = { ...curve, id: 'c0ffee00-0000-4000-8000-000000000002', name: null };
		const labels = cellCurves(cellWith([other, curve, other]), '/admin').map((c) => c.label);
		expect(labels).toEqual(['Curve c0ffee00', 'plate 7']);
	});
});

describe('visitCellCurveMark', () => {
	it('marks nothing on a value no curve corrected', () => {
		expect(visitCellCurveMark({ curves: [] })).toBeNull();
	});

	it('names the curve a corrected value was made with', () => {
		const mark = visitCellCurveMark({ curves: [{ id: curve.id, name: 'Curve 2026-03' }] });
		expect(mark).toEqual({ text: 'c', title: 'Corrected with Curve 2026-03' });
	});

	it('names every curve of a group corrected through two, and an unnamed one by its id', () => {
		const mark = visitCellCurveMark({
			curves: [{ id: curve.id, name: 'plate 7' }, { id: 'abcdef12-0000-4000-8000-000000000002' }],
		});
		expect(mark?.title).toBe('Corrected with plate 7, Curve abcdef12');
	});
});
