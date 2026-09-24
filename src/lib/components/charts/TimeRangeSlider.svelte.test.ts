import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';

import { formatInstant } from '$lib/utils';
import TimeRangeSlider from './TimeRangeSlider.svelte';
import Harness, { HARNESS_MIN } from './TimeRangeSliderHarness.test.svelte';

const MIN = Date.UTC(2026, 8, 1);
const MAX = Date.UTC(2026, 8, 23, 12, 30);

function sliderApi(container: HTMLElement) {
	return (container.querySelector('.noUi-target') as HTMLElement & { noUiSlider: unknown }).noUiSlider;
}

describe('time range slider', () => {
	it('labels each handle with the instant as every chart tooltip prints it', () => {
		const start = Date.UTC(2026, 8, 20, 12, 30);
		const { container } = render(TimeRangeSlider, { min: MIN, max: MAX, start, end: MAX });
		const tooltips = [...container.querySelectorAll('.noUi-tooltip')].map((t) => t.textContent);
		expect(tooltips).toEqual([formatInstant(start), formatInstant(MAX)]);
	});

	it('takes presses straight after its bounds and range move to an instant off the step', () => {
		const { container, component } = render(Harness);
		// A site's extent loading, with a range 3 min past a ten-minute step from min, in the
		// history segment where the step applies
		const max = Date.UTC(2026, 8, 23, 12, 40);
		flushSync(() => component.setBounds(HARNESS_MIN, max, Date.UTC(2026, 8, 10, 12, 33), max));
		expect(container.querySelector('.noUi-target')!.classList).not.toContain('noUi-state-tap');
	});

	it('keeps the same slider when the range it reports changes', () => {
		const { container, component } = render(Harness);
		const before = sliderApi(container);
		flushSync(() => component.setRange(Date.UTC(2026, 8, 18), Date.UTC(2026, 8, 20)));
		expect(sliderApi(container)).toBe(before);
	});
});
