<script lang="ts">
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { uPlotTheme } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';
	import { bandAtTime, calibrationAtTime } from '$lib/charts/overlay-plugins';

	let { syncKey }: { syncKey: string } = $props();

	const group = getChartSyncGroup(syncKey);

	const visible = $derived(group.cursor != null);

	interface AnnotationRow {
		id: string;
		text: string;
		category: string;
		bg: string;
	}

	interface Row {
		name: string;
		value: string;
		units: string;
		color: string;
		severity: 'alarm' | 'warning' | null;
		flagged: boolean;
		flagReason: string | null;
		annotations: AnnotationRow[];
		sensorLabel: string | null;
		calEquation: string | null;
	}

	const cursorTimeSec = $derived.by(() => {
		const c = group.cursor;
		if (!c) return null;
		for (const [, reg] of group.registrations) {
			const ts = reg.times[c.idx];
			if (ts != null) return ts;
		}
		return null;
	});

	const rows = $derived.by(() => {
		const c = group.cursor;
		if (!c) return [] as Row[];
		const ts = cursorTimeSec;
		const tMs = ts != null ? ts * 1000 : null;
		const colors = uPlotTheme.annotationCategoryColors as Record<string, string>;

		const result: Row[] = [];

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

			const flagged = reg.flags?.[c.idx] === true;
			const flagReason = flagged ? (reg.flagReasons?.[c.idx] ?? null) : null;

			let sensorLabel: string | null = null;
			let calEquation: string | null = null;
			if (ts != null) {
				const band = reg.sensorBands?.length ? bandAtTime(reg.sensorBands, ts) : null;
				if (band) sensorLabel = band.sensor_name ?? band.sensor_serial ?? band.site_name ?? null;
				const cal = reg.calibrationMarkers?.length ? calibrationAtTime(reg.calibrationMarkers, ts) : null;
				if (cal) calEquation = `y = ${cal.slope}x + ${cal.intercept}`;
			}

			const rowAnns: AnnotationRow[] = [];
			if (tMs != null) {
				for (const a of reg.annotations ?? []) {
					const start = new Date(a.start_time).getTime();
					const end = new Date(a.end_time).getTime();
					if (tMs >= start && tMs <= end) {
						rowAnns.push({
							id: a.id,
							text: a.text,
							category: a.category,
							bg: colors[a.category] ?? colors.other,
						});
					}
				}
			}

			result.push({
				name: reg.parameterName,
				value: val != null ? val.toFixed(2) : '--',
				units: reg.units,
				color,
				severity,
				flagged,
				flagReason,
				annotations: rowAnns,
				sensorLabel,
				calEquation,
			});
		}
		return result;
	});

	const timeLabel = $derived.by(() => {
		const ts = cursorTimeSec;
		if (ts == null) return '';
		return new Date(ts * 1000).toLocaleString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: '2-digit', minute: '2-digit',
			timeZone: 'UTC', timeZoneName: 'short',
		});
	});

	const position = $derived.by(() => {
		const c = group.cursor;
		if (!c) return { left: 0, top: 0 };
		let left = c.mouseX + 20;
		let top = c.mouseY + 20;
		const extraRows = rows.reduce((acc, r) => acc + r.annotations.length + (r.flagged ? 1 : 0) + (r.sensorLabel ? 1 : 0) + (r.calEquation ? 1 : 0), 0);
		const w = 280, h = (rows.length + extraRows) * 22 + 32;
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
		style="left:{position.left}px;top:{position.top}px;background:{uPlotTheme.tooltipBg};padding:6px 10px;border-radius:{uPlotTheme.tooltipRadius}px;white-space:nowrap;min-width:180px;max-width:380px"
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
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.severity.warning.main};color:#3a2a00;font-weight:700">WARN</span>
					{/if}
					{#if row.flagged}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.markers.flagged.stroke};color:white;font-weight:700">FLAG</span>
					{/if}
				</span>
				<span style="color:{uPlotTheme.tooltipColor};font-weight:600;font-variant-numeric:tabular-nums">{row.value} <span style="opacity:0.6;font-weight:400">{row.units}</span></span>
			</div>
			{#if row.sensorLabel || row.calEquation}
				<div style="margin:4px 0 2px 14px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.15)">
					{#if row.sensorLabel}
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Sensor: <span style="font-weight:600">{row.sensorLabel}</span></div>
					{/if}
					{#if row.calEquation}
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Calibration: {row.calEquation}</div>
					{/if}
				</div>
			{/if}
			{#if row.flagged && row.flagReason}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};opacity:0.7;padding-left:14px;white-space:normal;line-height:14px;margin-bottom:2px">{row.flagReason}</div>
			{/if}
			{#each row.annotations as a}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};line-height:14px;white-space:normal;padding-left:14px;margin-bottom:2px" class="flex items-start gap-1.5">
					<span style="display:inline-block;width:6px;height:6px;border-radius:2px;background:{a.bg};flex-shrink:0;margin-top:4px"></span>
					<span><span style="opacity:0.7">{a.category}:</span> {a.text}</span>
				</div>
			{/each}
		{/each}
	</div>
{/if}
