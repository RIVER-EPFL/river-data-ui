<script lang="ts">
	import { toastStore } from '$lib/stores/toast.svelte';

	let {
		text,
		label = 'Copy',
		small = false,
	}: {
		text: string;
		label?: string;
		small?: boolean;
	} = $props();

	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
			copied = true;
			toastStore.success('Copied to clipboard');
			setTimeout(() => (copied = false), 1500);
		} catch {
			toastStore.error('Copy failed');
		}
	}
</script>

<button
	type="button"
	onclick={copy}
	class="border border-brand-divider rounded bg-brand-surface hover:bg-brand-bg cursor-pointer {small
		? 'text-xs px-2 py-0.5'
		: 'text-sm px-3 py-1.5 font-medium'}"
>
	{copied ? 'Copied ✓' : label}
</button>
