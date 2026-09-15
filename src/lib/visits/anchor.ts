// Holding a clicked element still while the content around it changes height.
//
// The visits table opens a record inside the row, and closes whatever row was open above it. Both
// change the height of content the reader is scrolled past, which moves the page under them.

/** The nearest ancestor that scrolls, or the document when nothing between does. */
export function scrollParent(el: HTMLElement): Element {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if (overflow === 'auto' || overflow === 'scroll') return node;
	}
	return document.scrollingElement ?? document.documentElement;
}

/**
 * Records where `el` sits in the viewport. Call the returned function once the surrounding content
 * has settled to put it back there.
 */
export function holdInPlace(el: HTMLElement): () => void {
	const scroller = scrollParent(el);
	const top = el.getBoundingClientRect().top;
	return () => {
		const moved = el.getBoundingClientRect().top - top;
		if (moved !== 0) scroller.scrollTop += moved;
	};
}
