<script lang="ts">
	import { uPlotTheme } from '$lib/charts/uPlotTheme';
	import { chartKeyEntries, type ChartKeyPresence } from '$lib/charts/chartKey';

	let { presence, seriesColor = null }: { presence: ChartKeyPresence; seriesColor?: string | null } =
		$props();

	const entries = $derived(chartKeyEntries(presence));
	const line = $derived(seriesColor ?? uPlotTheme.grabSampleStroke);
</script>

{#if entries.length > 0}
	<div
		class="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-1 text-[10px] text-brand-muted"
		data-testid="chart-key"
	>
		{#each entries as entry (entry.mark + entry.label)}
			<span class="flex items-center gap-1.5">
				<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true" class="shrink-0">
					{#if entry.mark === 'line'}
						<line x1="1" y1="6" x2="17" y2="6" stroke={line} stroke-width="2" />
					{:else if entry.mark === 'spot'}
						<polygon points="9,2 13,6 9,10 5,6" fill={line} stroke={line} stroke-width="1.5" />
					{:else if entry.mark === 'spotSingle'}
						<polygon points="9,2 13,6 9,10 5,6" fill="none" stroke={line} stroke-width="1.5" />
					{:else if entry.mark === 'spotAgreed'}
						<line x1="3" y1="6" x2="15" y2="6" stroke={line} stroke-width="1.5" />
						<polygon points="9,3 12,6 9,9 6,6" fill={line} stroke={line} stroke-width="1.5" />
					{:else if entry.mark === 'sdBar'}
						<line x1="9" y1="1" x2="9" y2="11" stroke={line} stroke-width="1.5" />
						<line x1="5" y1="1" x2="13" y2="1" stroke={line} stroke-width="1.5" />
						<line x1="5" y1="11" x2="13" y2="11" stroke={line} stroke-width="1.5" />
					{:else if entry.mark === 'replicateDot'}
						<circle cx="5" cy="4" r="1.8" fill={line} />
						<circle cx="9" cy="8" r="1.8" fill={line} />
						<circle cx="13" cy="5" r="1.8" fill={line} />
					{:else if entry.mark === 'flagged'}
						<line x1="5" y1="2" x2="13" y2="10" stroke={uPlotTheme.flaggedColor} stroke-width="1.5" />
						<line x1="13" y1="2" x2="5" y2="10" stroke={uPlotTheme.flaggedColor} stroke-width="1.5" />
					{:else if entry.mark === 'withdrawn'}
						<circle cx="9" cy="6" r="4.5" fill="none" stroke={line} stroke-width="1.5" stroke-dasharray="3 2" opacity="0.6" />
					{:else if entry.mark === 'minMaxBand'}
						<rect x="1" y="3" width="16" height="6" fill={line} opacity="0.25" />
					{:else if entry.mark === 'sensorBand'}
						<rect x="1" y="4" width="7" height="4" fill={line} opacity="0.7" />
						<rect x="10" y="4" width="7" height="4" fill={line} opacity="0.35" />
					{:else if entry.mark === 'calibrationMarker'}
						<line x1="9" y1="1" x2="9" y2="11" stroke={line} stroke-width="1.5" stroke-dasharray="3 2" />
					{:else}
						<rect x="1" y="2" width="16" height="8" fill={entry.color ?? line} />
					{/if}
				</svg>
				{entry.label}
			</span>
		{/each}
	</div>
{/if}
