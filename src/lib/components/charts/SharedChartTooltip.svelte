<script lang="ts">
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { uPlotTheme } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';

	let { syncKey }: { syncKey: string } = $props();

	const group = getChartSyncGroup(syncKey);

	const visible = $derived(group.cursor != null);

	const rows = $derived.by(() => {
		const c = group.cursor;
		if (!c) return [];

		const result: Array<{
			name: string;
			value: string;
			units: string;
			color: string;
			severity: 'alarm' | 'warning' | null;
		}> = [];

		for (const [, reg] of group.registrations) {
			const val = reg.values[c.idx];
			const color = tokens.dataViz[reg.paletteIndex % tokens.dataViz.length];

			let severity: 'alarm' | 'warning' | null = null;
			if (reg.threshold && val != null) {
				const th = reg.threshold;
				if ((th.alarm_min != null && val < th.alarm_min) || (th.alarm_max != null && val > th.alarm_max)) {
					severity = 'alarm';
				} else if ((th.warning_min != null && val < th.warning_min) || (th.warning_max != null && val > th.warning_max)) {
					severity = 'warning';
				}
			}

			result.push({
				name: reg.parameterName,
				value: val != null ? val.toFixed(2) : '--',
				units: reg.units,
				color,
				severity,
			});
		}
		return result;
	});

	const timeLabel = $derived.by(() => {
		const c = group.cursor;
		if (!c) return '';
		for (const [, reg] of group.registrations) {
			const ts = reg.times[c.idx];
			if (ts != null) {
				return new Date(ts * 1000).toLocaleString('en-US', {
					month: 'short', day: 'numeric', year: 'numeric',
					hour: '2-digit', minute: '2-digit',
				});
			}
		}
		return '';
	});

	const position = $derived.by(() => {
		const c = group.cursor;
		if (!c) return { left: 0, top: 0 };
		let left = c.mouseX + 20;
		let top = c.mouseY + 20;
		const w = 220, h = rows.length * 22 + 32;
		if (left + w > window.innerWidth - 10) left = c.mouseX - w - 20;
		if (top + h > window.innerHeight - 10) top = c.mouseY - h - 20;
		if (left < 10) left = 10;
		if (top < 10) top = 10;
		return { left, top };
	});
</script>

{#if visible && rows.length > 0}
	<div
		class="fixed z-50 pointer-events-none"
		style="left:{position.left}px;top:{position.top}px;background:{uPlotTheme.tooltipBg};padding:6px 10px;border-radius:{uPlotTheme.tooltipRadius}px;white-space:nowrap;min-width:160px"
	>
		<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.6;margin-bottom:4px">{timeLabel}</div>
		{#each rows as row}
			<div class="flex items-center justify-between gap-4" style="font-size:12px;line-height:20px">
				<span class="flex items-center gap-1.5">
					<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{row.color};flex-shrink:0"></span>
					<span style="color:{row.color};font-weight:500">{row.name}</span>
					{#if row.severity === 'alarm'}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.severity.alarm.main};color:white;font-weight:700">ALARM</span>
					{:else if row.severity === 'warning'}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.severity.warning.main};color:white;font-weight:700">WARN</span>
					{/if}
				</span>
				<span style="color:{uPlotTheme.tooltipColor};font-weight:600;font-variant-numeric:tabular-nums">{row.value} <span style="opacity:0.6;font-weight:400">{row.units}</span></span>
			</div>
		{/each}
	</div>
{/if}
