// Focus the element when it mounts.
//
// An inline edit swaps a cell for an input, and the keyboard has to follow. `autofocus` does not:
// the attribute acts only on the document's first load, so a second cell entered for editing is
// rendered focusless.
export function focusOnMount(node: HTMLElement) {
	node.focus();
}
