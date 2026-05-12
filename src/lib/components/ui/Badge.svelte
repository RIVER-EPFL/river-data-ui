<script lang="ts">
	let {
		variant = 'default',
		children,
	}: {
		variant?: 'default' | 'ok' | 'warning' | 'alarm' | 'muted';
		children: import('svelte').Snippet;
	} = $props();

	const variants: Record<string, string> = {
		default: 'bg-brand-primary/10 text-brand-primary',
		ok: 'bg-severity-ok-soft text-severity-ok',
		warning: 'bg-severity-warning-soft text-severity-warning',
		alarm: 'bg-severity-alarm-soft text-severity-alarm',
		muted: 'bg-brand-bg text-brand-muted',
	};
</script>

<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full {variants[variant]}">
	{@render children()}
</span>
