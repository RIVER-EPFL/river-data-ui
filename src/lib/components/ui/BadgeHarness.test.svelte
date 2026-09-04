<script lang="ts">
	import Badge from './Badge.svelte';

	let { variant, label }: { variant: 'default' | 'ok' | 'warning' | 'alarm' | 'muted' | 'accent'; label: string } =
		$props();
</script>

<Badge {variant}>{label}</Badge>
