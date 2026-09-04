import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
import SharedChartTooltip from './SharedChartTooltip.svelte';

const KEY = 'tooltip-test';
const T = 1_760_000_000;

function registerSeries(id: string, name: string, value: number) {
	getChartSyncGroup(KEY).register({
		id,
		parameterName: name,
		units: 'uM',
		paletteIndex: 0,
		times: [T],
		values: [value],
		originLabel: `via cnet sync (${name})`,
	});
}

describe('SharedChartTooltip', () => {
	beforeEach(() => {
		getChartSyncGroup(KEY).clear();
		registerSeries('a', 'DOC', 1.5);
		registerSeries('b', 'DIC', 2.5);
		registerSeries('c', 'Turbidity', 3.5);
	});

	it('details only the chart under the cursor, listing the rest as one line each', () => {
		getChartSyncGroup(KEY).setCursor({ idx: 0, mouseX: 100, mouseY: 100, sourceId: 'b' });
		render(SharedChartTooltip, { syncKey: KEY });

		expect(screen.getByText('DOC')).toBeTruthy();
		expect(screen.getByText('DIC')).toBeTruthy();
		expect(screen.getByText('Turbidity')).toBeTruthy();

		expect(screen.getByText('via cnet sync (DIC)')).toBeTruthy();
		expect(screen.queryByText('via cnet sync (DOC)')).toBeNull();
		expect(screen.queryByText('via cnet sync (Turbidity)')).toBeNull();
	});

	it('keeps every row detailed when the cursor names no chart', () => {
		getChartSyncGroup(KEY).setCursor({ idx: 0, mouseX: 100, mouseY: 100 });
		render(SharedChartTooltip, { syncKey: KEY });

		expect(screen.getByText('via cnet sync (DOC)')).toBeTruthy();
		expect(screen.getByText('via cnet sync (DIC)')).toBeTruthy();
	});
});
