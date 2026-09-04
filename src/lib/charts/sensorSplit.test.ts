import { describe, expect, it } from 'vitest';

import type { AggregatesParameter } from '$lib/api/types';
import { groupBySlot } from './sensorSplit';

function series(id: string, sensorId: string | null, avg: (number | null)[]): AggregatesParameter {
	return {
		id,
		parameter_id: `${id}-param`,
		name: 'Dissolved oxygen',
		units: 'uM',
		avg,
		min: avg,
		max: avg,
		count: avg.map(() => 1),
		sensor_id: sensorId,
	};
}

const label = (id: string | null | undefined) => id ?? 'unattributed';

describe('splitting a slot by instrument', () => {
	it('keeps one line per instrument, in the order the server returned them', () => {
		const slots = groupBySlot(
			[
				series('slot-a', 'sensor-1', [1, 2]),
				series('slot-a', 'sensor-2', [3, 4]),
				series('slot-b', 'sensor-3', [5, 6]),
			],
			label,
		);

		expect([...slots.keys()]).toEqual(['slot-a', 'slot-b']);
		const a = slots.get('slot-a')!;
		expect(a.primaryLabel).toBe('sensor-1');
		expect(a.primary.avg).toEqual([1, 2]);
		expect(a.extras).toEqual([{ label: 'sensor-2', values: [3, 4] }]);
		expect(slots.get('slot-b')!.extras).toEqual([]);
	});

	it('reads a merged response as one line per slot with nothing beside it', () => {
		const slots = groupBySlot([series('slot-a', null, [1, 2])], label);
		expect(slots.get('slot-a')!.extras).toEqual([]);
		expect(slots.get('slot-a')!.primaryLabel).toBe('unattributed');
	});

	it('names an unattributed series rather than dropping it', () => {
		const slots = groupBySlot(
			[series('slot-a', 'sensor-1', [1]), series('slot-a', null, [9])],
			label,
		);
		expect(slots.get('slot-a')!.extras).toEqual([{ label: 'unattributed', values: [9] }]);
	});
});
