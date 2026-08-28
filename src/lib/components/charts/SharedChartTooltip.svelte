<script lang="ts">
	import { getChartSyncGroup } from '$lib/charts/chart-sync.svelte';
	import { uPlotTheme } from '$lib/charts/uPlotTheme';
	import { tokens } from '$lib/charts/tokens';
	import { bandAtTime, calibrationAtTime, severityForValue } from '$lib/charts/overlay-plugins';
	import { severityLabel } from '$lib/alarms';
	import { curveRefs } from '$lib/curveRefs.svelte';
	import { formatEquation } from '$lib/standardCurves';
	import { timezoneStore } from '$lib/stores/timezone.svelte';

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
		sampleLine: string | null;
		// A grab point under the cursor can be clicked open; the panel behind it is the only route
		// to the replicates and to the tool run that produced them, so the tooltip says so.
		spotClickable: boolean;
		// One-line ingestion origin for the series (from include_origin).
		originLabel: string | null;
		annotations: AnnotationRow[];
		sensorLabel: string | null;
		calEquation: string | null;
		// Corrections the point itself records. Both are reported even when null, since a value
		// with no curve applied reads differently from one corrected by an identity curve.
		recordedCurves: {
			calibration: string;
			standardCurve: string;
			standardCurveEquation: string | null;
			raw: number | null;
			calibrated: number | null;
		} | null;
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

			const sevLevel = severityForValue(val, reg.threshold);
			const severity: 'alarm' | 'warning' | null =
				sevLevel === 2 ? 'alarm' : sevLevel === 1 ? 'warning' : null;

			const flagged = reg.flags?.[c.idx] === true;
			const flagReason = flagged ? (reg.flagReasons?.[c.idx] ?? null) : null;

			let sensorLabel: string | null = null;
			let calEquation: string | null = null;
			if (ts != null) {
				const band = reg.sensorBands?.length ? bandAtTime(reg.sensorBands, ts) : null;
				if (band) sensorLabel = band.sensor_name ?? band.sensor_serial ?? band.site_name ?? null;
				const cal = reg.calibrationMarkers?.length ? calibrationAtTime(reg.calibrationMarkers, ts) : null;
				if (cal) calEquation = formatEquation(cal.slope, cal.intercept);
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

			// A spot point backed by a sample shows the replicates behind its mean
			let sampleLine: string | null = null;
			let spotClickable = false;
			let recordedCurves: Row['recordedCurves'] = null;
			if (tMs != null) {
				const stat = reg.spotStats?.get(tMs);
				spotClickable = (stat?.replicates?.length ?? 0) > 0;
				if (stat && (stat.calibrationId !== undefined || stat.standardCurveId !== undefined)) {
					const rep = stat.n === 1 ? (stat.replicates?.[0] ?? null) : null;
					recordedCurves = {
						calibration: curveRefs.calibrationLabel(stat.calibrationId),
						standardCurve: curveRefs.standardCurveLabel(stat.standardCurveId),
						standardCurveEquation: curveRefs.standardCurveEquation(stat.standardCurveId),
						raw: rep != null && rep.calibrated_value != null ? rep.raw_value : null,
						calibrated: rep?.calibrated_value ?? null,
					};
				}
				if (stat && stat.n >= 2) {
					const reps = (stat.replicates ?? [])
						.map((r) => (r.calibrated_value ?? r.raw_value).toFixed(2) + (r.flagged ? '*' : ''))
						.join(', ');
					const sd = stat.stdev != null ? ` ±${stat.stdev.toFixed(2)}` : '';
					sampleLine = reps
						? `mean of ${stat.n}${sd}: ${reps}`
						: `mean of ${stat.n} replicates${sd}`;
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
				sampleLine,
				spotClickable,
				originLabel: reg.originLabel || null,
				annotations: rowAnns,
				sensorLabel,
				calEquation,
				recordedCurves,
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
			timeZone: timezoneStore.zone, timeZoneName: 'short',
		});
	});

	// When showing local time, also surface the underlying UTC instant on hover.
	const utcLabel = $derived.by(() => {
		const ts = cursorTimeSec;
		if (ts == null || timezoneStore.mode === 'utc') return '';
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
		const extraRows = rows.reduce((acc, r) => acc + r.annotations.length + (r.flagged ? 1 : 0) + (r.sensorLabel ? 1 : 0) + (r.recordedCurves ? (r.recordedCurves.raw != null ? 3 : 2) : r.calEquation ? 1 : 0), 0);
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
		<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.6;margin-bottom:4px">
			{timeLabel}{#if utcLabel}<span style="opacity:0.7"> · {utcLabel}</span>{/if}
		</div>
		{#each rows as row}
			<div class="flex items-center justify-between gap-4" style="font-size:12px;line-height:20px">
				<span class="flex items-center gap-1.5">
					<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{row.color};flex-shrink:0"></span>
					<span style="color:{row.color};font-weight:500">{row.name}</span>
					{#if row.severity === 'alarm'}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.severity.alarm.main};color:white;font-weight:700">{severityLabel('alarm')}</span>
					{:else if row.severity === 'warning'}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.severity.warning.main};color:{tokens.severity.warning.text};font-weight:700">{severityLabel('warning')}</span>
					{/if}
					{#if row.flagged}
						<span style="font-size:9px;padding:0 4px;border-radius:3px;background:{tokens.markers.flagged.stroke};color:white;font-weight:700">FLAG</span>
					{/if}
				</span>
				<span style="color:{uPlotTheme.tooltipColor};font-weight:600;font-variant-numeric:tabular-nums">{row.value} <span style="opacity:0.6;font-weight:400">{row.units}</span></span>
			</div>
			{#if row.sensorLabel || row.calEquation || row.recordedCurves}
				<div style="margin:4px 0 2px 14px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.15)">
					{#if row.sensorLabel}
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Sensor: <span style="font-weight:600">{row.sensorLabel}</span></div>
					{/if}
					{#if row.recordedCurves}
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Calibration: {row.recordedCurves.calibration}</div>
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">
							Standard curve: {row.recordedCurves.standardCurve}{#if row.recordedCurves.standardCurveEquation}&nbsp;· {row.recordedCurves.standardCurveEquation}{/if}
						</div>
						{#if row.recordedCurves.raw != null}
							<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Raw {row.recordedCurves.raw} → {row.recordedCurves.calibrated}</div>
						{/if}
					{:else if row.calEquation}
						<div style="font-size:11px;color:{uPlotTheme.tooltipColor};opacity:0.9;line-height:16px">Calibration: {row.calEquation}</div>
					{/if}
				</div>
			{/if}
			{#if row.flagged && row.flagReason}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};opacity:0.7;padding-left:14px;white-space:normal;line-height:14px;margin-bottom:2px">{row.flagReason}</div>
			{/if}
			{#if row.sampleLine}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};opacity:0.8;padding-left:14px;white-space:normal;line-height:14px;margin-bottom:2px">{row.sampleLine}</div>
			{/if}
			{#if row.originLabel}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};opacity:0.7;padding-left:14px;white-space:normal;line-height:14px;margin-bottom:2px">{row.originLabel}</div>
			{/if}
			{#if row.spotClickable}
				<div style="font-size:10px;color:{uPlotTheme.tooltipColor};opacity:0.7;padding-left:14px;white-space:normal;line-height:14px;margin-bottom:2px">Click for the full record</div>
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
