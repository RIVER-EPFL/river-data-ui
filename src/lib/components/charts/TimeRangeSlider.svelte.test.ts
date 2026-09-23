import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import { formatInstant } from '$lib/utils';
import TimeRangeSlider from './TimeRangeSlider.svelte';

const MIN = Date.UTC(2026, 8, 1);
const MAX = Date.UTC(2026, 8, 23, 12, 30);

describe('time range slider', () => {
	it('labels each handle with the instant as every chart tooltip prints it', () => {
		const start = Date.UTC(2026, 8, 20, 12, 30);
		const { container } = render(TimeRangeSlider, { min: MIN, max: MAX, start, end: MAX });
		const tooltips = [...container.querySelectorAll('.noUi-tooltip')].map((t) => t.textContent);
		expect(tooltips).toEqual([formatInstant(start), formatInstant(MAX)]);
	});
});
