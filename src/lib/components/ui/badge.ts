export type BadgeVariant = 'default' | 'ok' | 'warning' | 'alarm' | 'muted' | 'accent';

export const BADGE_BASE =
	'inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium rounded-full';

export const BADGE_VARIANTS: Record<BadgeVariant, string> = {
	default: 'bg-brand-primary/10 text-brand-primary',
	ok: 'bg-severity-ok-soft text-severity-ok',
	warning: 'bg-severity-warning-soft text-severity-warning',
	alarm: 'bg-severity-alarm-soft text-severity-alarm',
	muted: 'bg-brand-bg text-brand-muted',
	accent: 'bg-brand-accent/10 text-brand-accent-dark',
};
