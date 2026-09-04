<script lang="ts">
	let { xLabel, yLabel }: { xLabel: string; yLabel: string } = $props();
</script>

<div data-testid="scatter-plot">{xLabel} vs {yLabel}</div>
