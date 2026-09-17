<script lang="ts">
	import { toastStore } from '$lib/stores/toast.svelte';

	const typeStyles: Record<string, string> = {
		success: 'bg-severity-ok text-white',
		error: 'bg-severity-alarm text-white',
		info: 'bg-brand-primary text-white',
	};
</script>

{#if toastStore.items.length > 0}
	<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
		{#each toastStore.items as toast (toast.id)}
			<div class="px-4 py-2.5 rounded-md shadow-lg text-sm {typeStyles[toast.type]} flex items-center gap-2">
				<span class="flex-1">{toast.message}</span>
				{#if toast.action}
					<button
						class="bg-transparent border border-white/60 rounded px-2 py-0.5 text-inherit cursor-pointer text-xs font-semibold hover:bg-white/10"
						onclick={() => { toast.action?.run(); toastStore.dismiss(toast.id); }}
					>{toast.action.label}</button>
				{/if}
				<button
					class="opacity-70 hover:opacity-100 bg-transparent border-none text-inherit cursor-pointer text-base"
					onclick={() => toastStore.dismiss(toast.id)}
					aria-label="Dismiss notification"
				>
					&times;
				</button>
			</div>
		{/each}
	</div>
{/if}
