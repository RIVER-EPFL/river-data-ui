// Presentation helpers for Keycloak realm roles. Only the riverdata-* roles are river-data
// access levels; everything else on an account (directory/group roles from the central realm)
// is noise in this UI.

export const ACCESS_ROLE_LABELS: Record<string, string> = {
	'riverdata-admin': 'Administrator',
	'riverdata-manager': 'Manager',
	'riverdata-river': 'River',
	'riverdata-user': 'River',
	'riverdata-intern': 'Intern',
};

export function accessRoles(roles: string[] | undefined): string[] {
	return (roles ?? []).filter((r) => r in ACCESS_ROLE_LABELS);
}

// Highest-to-lowest access level; the first one a user holds is their effective level.
const ROLE_PRIORITY = [
	'riverdata-admin',
	'riverdata-manager',
	'riverdata-river',
	'riverdata-user',
	'riverdata-intern',
];

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

export function roleBadgeVariant(role: string): 'accent' | 'default' {
	return role === 'riverdata-admin' || role === 'riverdata-manager' ? 'accent' : 'default';
}
