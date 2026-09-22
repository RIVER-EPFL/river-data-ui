<script lang="ts">
	import Button from '$components/ui/Button.svelte';

	// A button asked twice: the first press turns it into its own confirmation, the second acts.
	// It needs no panel, so nothing it says can be clipped by the table it sits in. Arming changes
	// the words and nothing else: a button that changes colour and shape under the cursor pulls the
	// eye off the row being read.
	let {
		label,
		confirmLabel,
		consequence,
		variant = 'ghost',
		onconfirm,
		timeoutMs = 4000,
	}: {
		label: string;
		/** What the armed button reads, e.g. "Click again to discard". */
		confirmLabel: string;
		/** What confirming changes, shown on hover of the armed button. */
		consequence: string;
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		onconfirm: () => void;
		timeoutMs?: number;
	} = $props();

	let armed = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function disarm() {
		armed = false;
		if (timer) clearTimeout(timer);
		timer = null;
	}

	function press(e: MouseEvent) {
		e.stopPropagation();
		if (!armed) {
			armed = true;
			timer = setTimeout(disarm, timeoutMs);
			return;
		}
		disarm();
		onconfirm();
	}
</script>

<Button
	size="sm"
	{variant}
	title={armed ? consequence : undefined}
	onclick={press}
	onblur={disarm}
>{armed ? confirmLabel : label}</Button>
