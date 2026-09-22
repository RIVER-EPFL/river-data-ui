<script lang="ts">
	// The hover tip beside a computed number or a download: a circled "i" carrying its explanation
	// as the native tooltip. Focusable, so the text is reachable without a pointer.
	let { text, class: cls = 'h-4 w-4' }: { text: string; class?: string } = $props();
</script>

<button
	type="button"
	aria-label={text}
	title={text}
	class="inline-flex items-center text-brand-muted cursor-help align-middle"
>
	<svg
		class={cls}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" />
	</svg>
</button>
