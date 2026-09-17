/// The pairing review's tab strip. Each tab lists one kind of thing the plan pairs onto or creates,
/// and carries how many of them have been reviewed.

export type ReviewTab = 'projects' | 'sites' | 'parameters' | 'instruments' | 'curves';

/**
 * The tab on screen. The operator's own click is answered whatever the counts say, so reviewing
 * the last item does not move them off the tab they are reading. With no click, or a chosen tab
 * that is not on the strip, the review opens on the first tab still to review.
 */
export function activeReviewTab(
	chosen: ReviewTab | null,
	tabs: Array<{ tab: ReviewTab; state: string }>,
): ReviewTab {
	if (chosen && tabs.some((t) => t.tab === chosen)) return chosen;
	return tabs.find((t) => t.state === 'blocking')?.tab ?? 'parameters';
}
