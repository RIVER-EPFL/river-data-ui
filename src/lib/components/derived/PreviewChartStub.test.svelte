<script lang="ts">
	let { ...rest }: Record<string, unknown> = $props();
</script>

<div data-testid="chart" data-props={Object.keys(rest).length}></div>
