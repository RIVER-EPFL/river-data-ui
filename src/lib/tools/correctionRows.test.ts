import { describe, expect, it } from 'vitest';

import type { EventCell, ToolDescriptor, ToolParam } from '$api/service';
import { correctionNote, correctionRows } from './correctionRows';

function param(over: Partial<ToolParam>): ToolParam {
	return {
		name: 'temp',
		label: 'Field temperature',
		kind: 'number',
		units: '°C',
		required: true,
		default: null,
		when: null,
		...over,
	};
}

function tool(over: Partial<ToolDescriptor> = {}): Pick<ToolDescriptor, 'params' | 'event_inputs'> {
	return {
		params: [param({})],
		event_inputs: [{ param: 'temp', parameter_code: 'WaterTemp' }],
		...over,
	} as ToolDescriptor;
}

function cell(over: Partial<EventCell> = {}): EventCell {
	return {
		parameter_id: 'param-temp',
		parameter_code: 'WaterTemp',
		parameter_name: 'Water temperature',
		stream_id: 'stream',
		origin: 'manual',
		has_provenance: false,
		replicates: [],
		served_value: 10,
		...over,
	} as EventCell;
}

describe('a numeric input typed over on the tool form', () => {
	it('corrects the visit value the run replaced', () => {
		const rows = correctionRows(tool(), { temp: 14 }, [cell()]);
		expect(rows).toEqual([
			{
				param: 'temp',
				label: 'Field temperature',
				units: '°C',
				parameterCode: 'WaterTemp',
				parameterId: 'param-temp',
				value: 14,
				stored: 10,
			},
		]);
		expect(correctionNote(rows[0])).toBe('corrects Field temperature 10 to 14');
	});

	it('leaves a value the visit already holds alone', () => {
		expect(correctionRows(tool(), { temp: 10 }, [cell()])).toEqual([]);
	});

	it('records a bound value the visit holds no cell for', () => {
		const rows = correctionRows(tool(), { temp: 14 }, []);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ parameterId: null, stored: null });
		expect(correctionNote(rows[0])).toBe(
			'records Field temperature 14, which this visit does not hold',
		);
	});

	it('matches the visit cell whatever case the binding names the code in', () => {
		const t = tool({ event_inputs: [{ param: 'temp', parameter_code: 'watertemp' }] });
		expect(correctionRows(t, { temp: 14 }, [cell()])[0].parameterId).toBe('param-temp');
	});

	it('leaves an unbound numeric param as a run-only setting', () => {
		const t = tool({ params: [param({}), param({ name: 'depth', label: 'Depth' })] });
		expect(correctionRows(t, { temp: 10, depth: 3 }, [cell()])).toEqual([]);
	});

	it('leaves a replicates param to the input rows', () => {
		const t = tool({
			params: [param({ name: 'doc', kind: 'replicates' })],
			event_inputs: [{ param: 'doc', parameter_code: 'DOC' }],
		});
		expect(correctionRows(t, { doc: [1, 2] }, [])).toEqual([]);
	});

	it('ignores a bound param the run carried no number for', () => {
		expect(correctionRows(tool(), { temp: null }, [cell()])).toEqual([]);
		expect(correctionRows(tool(), {}, [cell()])).toEqual([]);
	});
});
