// A visit's own verification state, separate from its measurements': an intern opens a field day
// pending, a manager rules on it in the review queue, and a rejected visit is withdrawn rather
// than deleted (Q177).

export type VerificationBadge = { label: string; variant: 'muted' | 'accent' | 'alarm' | 'warning' };

/**
 * The badge a visit carries for whether the field day itself has been ruled on, or nothing when it
 * stands accepted. The withdrawal wins: a rejected visit is no longer awaiting anything.
 */
export function verificationBadge(
	unverified: boolean | undefined,
	withdrawnAt: string | null | undefined
): VerificationBadge | null {
	if (withdrawnAt) return { label: 'rejected', variant: 'alarm' };
	if (unverified) return { label: 'pending review', variant: 'warning' };
	return null;
}

/** What a page says about a visit nobody has ruled on, so a person reads it beside the values. */
export const UNVERIFIED_VISIT_NOTICE =
	'This field day is awaiting review: its measurements cannot be verified until it is.';

/** The notice a visit carries, or nothing when the field day is settled. */
export function verificationNoticeFor(
	unverified: boolean | undefined,
	withdrawnAt: string | null | undefined
): string | null {
	if (withdrawnAt) return 'This field day was rejected: its measurements are withdrawn.';
	return unverified ? UNVERIFIED_VISIT_NOTICE : null;
}
