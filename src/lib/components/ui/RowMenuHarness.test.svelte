<script lang="ts">
	import RowMenu from './RowMenu.svelte';

	let { onpick }: { onpick: () => void } = $props();
</script>

<RowMenu label="Actions for DO">
	{#snippet children(close)}
		<button type="button" onclick={() => { onpick(); close(); }}>Merge…</button>
	{/snippet}
</RowMenu>
