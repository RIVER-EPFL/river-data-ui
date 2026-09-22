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

	it('prints the offset it applies and the instant it will send', async () => {
		render(Harness, { instant: '' });
		await fireEvent.change(zoneOf('Bound'), { target: { value: 'Europe/Zurich' } });
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '2026-01-15T10:30' } });
		expect(screen.getByText('UTC+1 applied, stored as 2026-01-15T09:30:00Z')).toBeTruthy();

		// The same zone in July applies the other offset, and the line moves with it.
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '2026-07-15T10:30' } });
		expect(screen.getByText('UTC+2 applied, stored as 2026-07-15T08:30:00Z')).toBeTruthy();
	});

	// A logger set to UTC+1 all year: the fixed offset is entered as itself, not as a zone.
	it('applies a fixed offset entry and says so', async () => {
		render(Harness, { instant: '' });
		await fireEvent.change(zoneOf('Bound'), { target: { value: 'UTC+01:00' } });
		await fireEvent.input(screen.getByLabelText('Bound'), { target: { value: '2026-07-15T10:30' } });
		expect(screen.getByTestId('bound').textContent).toBe('2026-07-15T09:30:00.000Z');
		expect(screen.getByText('UTC+1 applied, stored as 2026-07-15T09:30:00Z')).toBeTruthy();
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
