// Presentation helpers for Keycloak realm roles. Only the riverdata-* roles are river-data
// access levels; everything else on an account (directory/group roles from the central realm)
// is noise in this UI.

export const ACCESS_ROLE_LABELS: Record<string, string> = {
	'riverdata-admin': 'Administrator',
	'riverdata-manager': 'Manager',
	'riverdata-river': 'River',
	'riverdata-intern': 'Intern',
};

export function accessRoles(roles: string[] | undefined): string[] {
	return (roles ?? []).filter((r) => r in ACCESS_ROLE_LABELS);
}

// Highest-to-lowest access level; the first one a user holds is their effective level.
const ROLE_PRIORITY = ['riverdata-admin', 'riverdata-manager', 'riverdata-river', 'riverdata-intern'];

export function highestAccessRole(roles: string[] | undefined): string | null {
	return ROLE_PRIORITY.find((r) => (roles ?? []).includes(r)) ?? null;
}

/** The user's effective access level as a label ("Administrator" … "Intern"), or "No access". */
export function accessLevelLabel(roles: string[] | undefined): string {
	const role = highestAccessRole(roles);
	return role ? roleLabel(role) : 'No access';
}

export function roleLabel(role: string): string {
	return ACCESS_ROLE_LABELS[role] ?? role;
}

export type RoleVariant = 'accent' | 'default' | 'ok' | 'muted';

// One distinct chip colour per level so the list scans at a glance:
// Administrator = accent (orange), Manager = default (blue), River = ok (green), Intern = muted.
export function roleBadgeVariant(role: string): RoleVariant {
	switch (role) {
		case 'riverdata-admin':
			return 'accent';
		case 'riverdata-manager':
			return 'default';
		case 'riverdata-river':
			return 'ok';
		case 'riverdata-intern':
			return 'muted';
		default:
			return 'default';
	}
}

/** Chip colour for a user's effective (highest) level; muted when they have no access. */
export function accessLevelVariant(roles: string[] | undefined): RoleVariant {
	const role = highestAccessRole(roles);
	return role ? roleBadgeVariant(role) : 'muted';
}

// Telegram link state, as reported by GET /api/notifications/subscribers. A user with no
// subscriber row and no identity is absent from that roster entirely, which reads the same as
// `unlinked`, so callers pass undefined for "not on the roster".
export type TelegramLinkStatus = 'unlinked' | 'pending' | 'linked';

export function telegramLinkLabel(status: TelegramLinkStatus | undefined): string {
	switch (status) {
		case 'linked':
			return 'Linked';
		case 'pending':
			return 'Code pending';
		default:
			return 'Not linked';
	}
}

// Only a live link is affirmative. A pending code is a warning because it expires (60 min TTL),
// so a roster full of `pending` means people started linking and did not finish.
export function telegramLinkVariant(status: TelegramLinkStatus | undefined): RoleVariant {
	switch (status) {
		case 'linked':
			return 'ok';
		case 'pending':
			return 'accent';
		default:
			return 'muted';
	}
}
