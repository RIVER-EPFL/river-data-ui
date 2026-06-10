// Presentation helpers for Keycloak realm roles. Only the riverdata-* roles are river-data
// access levels; everything else on an account (directory/group roles from the central realm)
// is noise in this UI.

export const ACCESS_ROLE_LABELS: Record<string, string> = {
	'riverdata-admin': 'Administrator',
	'riverdata-user': 'User',
};

export function accessRoles(roles: string[] | undefined): string[] {
	return (roles ?? []).filter((r) => r in ACCESS_ROLE_LABELS);
}

export function roleLabel(role: string): string {
	return ACCESS_ROLE_LABELS[role] ?? role;
}

export function roleBadgeVariant(role: string): 'accent' | 'default' {
	return role === 'riverdata-admin' ? 'accent' : 'default';
}
