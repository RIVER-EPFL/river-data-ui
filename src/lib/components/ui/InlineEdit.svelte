<script lang="ts">
	import type { Snippet } from 'svelte';

	// A value shown as text, edited in place: leaving the field saves it, Escape puts it back.
	let {
		value,
		label,
		onsave,
		placeholder = '',
		required = false,
		inputClass = '',
		children,
	}: {
		value: string;
		label: string;
		onsave: (value: string) => Promise<void>;
		placeholder?: string;
		required?: boolean;
		inputClass?: string;
		children?: Snippet;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);

	function start() {
		draft = value;
		editing = true;
	}

	async function commit() {
		if (!editing) return;
		const next = draft.trim();
		editing = false;
		if (next === value || (required && !next)) return;
		saving = true;
		try {
			await onsave(next);
		} catch {
			draft = next;
			editing = true;
		} finally {
			saving = false;
		}
	}

	function keydown(e: KeyboardEvent) {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
		if (e.key === 'Escape') editing = false;
	}
</script>

{#if editing}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		type="text"
		aria-label={label}
		bind:value={draft}
		onkeydown={keydown}
		onblur={commit}
		autofocus
		{placeholder}
		class="min-w-48 rounded-md border border-brand-divider bg-brand-surface px-2 py-0.5 {inputClass}"
	/>
{:else}
	<span class="group inline-flex min-w-0 items-center gap-1.5" class:opacity-60={saving}>
		{#if value}
			{@render children?.()}
		{:else}
			<span class="text-sm italic text-brand-muted">{placeholder}</span>
		{/if}
		<button
			type="button"
			onclick={start}
			disabled={saving}
			aria-label="Edit {label.toLowerCase()}"
			title="Edit {label.toLowerCase()}"
			class="shrink-0 cursor-pointer rounded p-0.5 text-brand-muted opacity-50 hover:text-brand-primary group-hover:opacity-100 focus:opacity-100"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 20h9" />
				<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
			</svg>
		</button>
	</span>
{/if}
