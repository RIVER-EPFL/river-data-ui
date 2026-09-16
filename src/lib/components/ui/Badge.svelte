<script lang="ts">
	import { BADGE_BASE, BADGE_VARIANTS, type BadgeVariant } from './badge';

	let {
		variant = 'default',
		title,
		children,
	}: {
		variant?: BadgeVariant;
		title?: string;
		children: import('svelte').Snippet;
	} = $props();
</script>

<span {title} class="{BADGE_BASE} {BADGE_VARIANTS[variant]}">
	{@render children()}
</span>
