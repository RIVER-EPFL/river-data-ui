<script lang="ts">
	import Dialog from './Dialog.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<button data-testid="opener" onclick={() => (open = true)}>Open</button>
<Dialog bind:open title="A decision">
	<input data-testid="first" />
	<input data-testid="second" />
	{#snippet actions()}
		<button data-testid="close" onclick={() => (open = false)}>Close</button>
	{/snippet}
</Dialog>
