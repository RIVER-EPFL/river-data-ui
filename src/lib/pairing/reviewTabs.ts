/// The pairing review's tab strip. Objects is a tab of the same strip as the editors (U55): the
/// card it used to be stood above the strip, 28 rows tall on a Vaisala plan and over a hundred on
/// a CNET one, which put the review's own navigation a screen below its header.

export type ReviewTab = 'objects' | 'parameters' | 'sites' | 'instruments' | 'curves';

/**
 * The tab on screen. Objects opens the review while the plan has an object nobody has accepted,
 * since applying is refused until every one of them is; once they are all accepted, or the plan
 * creates nothing at all, the review opens on the cross-site editor instead.
 *
 * `chosen` is the operator's own click, which is answered whatever the objects say, so accepting
 * the last one does not move them off the tab they are reading.
 */
export function activeReviewTab(
	chosen: ReviewTab | null,
	objects: number,
	open: number,
): ReviewTab {
	const tab = chosen ?? (open > 0 ? 'objects' : 'parameters');
	return tab === 'objects' && objects === 0 ? 'parameters' : tab;
}

/** The Objects tab's label, carrying the count the apply gate is waiting on. */
export function objectsTabLabel(objects: number, open: number): string {
	return open > 0 ? `Objects (${open} to accept)` : `Objects (${objects})`;
}
