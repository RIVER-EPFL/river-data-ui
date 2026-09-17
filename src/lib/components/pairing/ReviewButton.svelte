<script lang="ts">
	import Button from '$components/ui/Button.svelte';

	// The one review control every tab of the pairing review uses, so the wording is the same on each.
	let {
		reviewed,
		onclick,
		blocked = null,
	}: {
		reviewed: boolean;
		onclick: () => void;
		/** Why the review cannot change from here, which disables the button. */
		blocked?: string | null;
	} = $props();
</script>

<Button
	size="sm"
	variant={reviewed ? 'ghost' : 'primary'}
	class="whitespace-nowrap {reviewed ? 'text-severity-ok' : ''}"
	disabled={blocked !== null}
	title={blocked ?? (reviewed ? 'Click to mark it unreviewed' : undefined)}
	{onclick}
>{reviewed ? '✓ Reviewed' : 'Mark reviewed'}</Button>
