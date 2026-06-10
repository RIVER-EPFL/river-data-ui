<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	let {
		variant = 'secondary',
		size = 'md',
		loading = false,
		class: className = '',
		children,
		...rest
	}: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		loading?: boolean;
		class?: string;
		children: Snippet;
	} & HTMLButtonAttributes = $props();

	const variants: Record<string, string> = {
		primary: 'bg-brand-primary text-white border-none hover:bg-brand-primary-dark',
		secondary: 'border border-brand-divider bg-brand-surface text-brand-text hover:bg-brand-bg',
		danger: 'bg-severity-alarm text-white border-none hover:opacity-90',
		ghost: 'bg-transparent border-none text-brand-muted hover:text-brand-text hover:underline',
	};
	const sizes: Record<string, string> = {
		md: 'px-3 py-1.5 text-sm',
		sm: 'px-2 py-1 text-xs',
	};
</script>

<button
	type="button"
	{...rest}
	disabled={loading || rest.disabled}
	class={cn(
		'rounded-md cursor-pointer font-medium disabled:opacity-50 disabled:cursor-default',
		variants[variant],
		sizes[size],
		className,
	)}
>
	{#if loading}<span aria-hidden="true">… </span>{/if}{@render children()}
</button>
