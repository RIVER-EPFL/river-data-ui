import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Harness from './TimestampInputHarness.test.svelte';

const zoneOf = (label: string) =>
	screen.getAllByLabelText('Time zone')[label === 'Bound' ? 0 : 1] as HTMLSelectElement;

describe('TimestampInput', () => {
	it('resolves what is typed in the chosen zone to the instant it binds', async () => {
		render(Harness, { instant: '' });
		await fireEvent.change(zoneOf('Bound'), { target: { value: 'UTC' } });
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '2026-01-15T10:30' } });
		expect(screen.getByTestId('bound').textContent).toBe('2026-01-15T10:30:00.000Z');
	});

	it('re-expresses the wall clock when the zone changes, leaving the instant where it was', async () => {
		render(Harness, { instant: '2026-01-15T09:30:00.000Z' });
		const field = screen.getByLabelText('Bound') as HTMLInputElement;
		await fireEvent.change(zoneOf('Bound'), { target: { value: 'UTC' } });
		expect(field.value).toBe('2026-01-15T09:30');
		expect(screen.getByTestId('bound').textContent).toBe('2026-01-15T09:30:00.000Z');

		await fireEvent.change(zoneOf('Bound'), { target: { value: 'Europe/Zurich' } });
		expect(field.value).toBe('2026-01-15T10:30');
		expect(screen.getByTestId('bound').textContent).toBe('2026-01-15T09:30:00.000Z');
	});

	it('prints the instant it will send', async () => {
		render(Harness, { instant: '' });
		await fireEvent.change(zoneOf('Bound'), { target: { value: 'Europe/Zurich' } });
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '2026-01-15T10:30' } });
		expect(screen.getByText('Stored as 2026-01-15T09:30:00Z')).toBeTruthy();
	});

	it('reports the instant to a caller that passes one down rather than binding', async () => {
		render(Harness, { oneWay: '2026-01-15T09:30:00.000Z' });
		await fireEvent.change(zoneOf('One way'), { target: { value: 'UTC' } });
		await fireEvent.input(screen.getByLabelText('One way'), { target: { value: '2026-02-01T00:00' } });
		expect(screen.getByTestId('echoed').textContent).toBe('2026-02-01T00:00:00.000Z');
	});

	it('clears the instant when the field is emptied', async () => {
		render(Harness, { instant: '2026-01-15T09:30:00.000Z' });
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '' } });
		expect(screen.getByTestId('bound').textContent).toBe('');
	});
});
