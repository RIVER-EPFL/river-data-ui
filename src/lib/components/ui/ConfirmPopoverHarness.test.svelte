<script lang="ts">
	import ConfirmPopover from './ConfirmPopover.svelte';
	import CountList from './CountList.svelte';

	let { message, rows }: { message: string; rows?: { label: string; value: string | number }[] } = $props();
</script>

<ConfirmPopover {message} onconfirm={() => {}}>
	{#snippet detail()}
		{#if rows}
			<CountList {rows} />
		{/if}
	{/snippet}
	<button>Trigger</button>
</ConfirmPopover>
