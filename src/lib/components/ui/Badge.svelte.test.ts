import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Badge from './Badge.svelte';
import BadgeHarness from './BadgeHarness.test.svelte';

describe('Badge', () => {
	it('renders its content', () => {
		render(BadgeHarness, { variant: 'warning', label: 'stale' });
		expect(screen.getByText('stale')).toBeTruthy();
	});

	it('carries the variant classes, falling back to nothing for an unknown one', () => {
		render(BadgeHarness, { variant: 'alarm', label: 'breach' });
		expect(screen.getByText('breach').className).toContain('text-severity-alarm');
	});

	it('is a span, so it never breaks the flow of the cell it sits in', () => {
		render(BadgeHarness, { variant: 'ok', label: 'paired' });
		expect(screen.getByText('paired').tagName).toBe('SPAN');
	});

	it('exports a component', () => {
		expect(Badge).toBeTruthy();
	});
});
