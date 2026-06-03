import type uPlot from 'uplot';
import { tokens } from './tokens';
import type { SensorIdentityBand, CalibrationMarker } from '$api/sensors';

export interface OverlayVisibility {
	sensorVectors: boolean;
	calibrationMarkers: boolean;
}

/** Stable colour for a deployment id → one of the colorblind-safe dataViz hues, low alpha. */
export function bandColor(deploymentId: string, alpha = 0.14): string {
	let h = 0;
	for (let i = 0; i < deploymentId.length; i++) h = (h * 31 + deploymentId.charCodeAt(i)) | 0;
	const hex = tokens.dataViz[Math.abs(h) % tokens.dataViz.length];
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r},${g},${b},${alpha})`;
}

const BAND_TOP_STRIP = 6; // px coloured strip at top, full-height tint below

/**
 * Sensor-identity bands. `bandsRef.current` and `visRef.current` are read live inside the
 * draw hook so toggling visibility only needs chart.redraw(), not a rebuild.
 */
export function sensorVectorBandPlugin(
	bandsRef: { current: SensorIdentityBand[] },
	visRef: { current: OverlayVisibility },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					if (!visRef.current.sensorVectors) return;
					const bands = bandsRef.current;
					if (!bands.length) return;
					const ctx = u.ctx;
					const { left, top, width, height } = u.bbox;
					ctx.save();
					ctx.beginPath();
					ctx.rect(left, top, width, height);
					ctx.clip();
					for (const b of bands) {
						const ts0 = new Date(b.from).getTime() / 1000;
						const ts1 = b.until ? new Date(b.until).getTime() / 1000 : u.scales.x.max!;
						const x0 = Math.max(u.valToPos(ts0, 'x', true), left);
						const x1 = Math.min(u.valToPos(ts1, 'x', true), left + width);
						if (x1 <= x0) continue;
						ctx.fillStyle = bandColor(b.deployment_id, 0.1);
						ctx.fillRect(x0, top, x1 - x0, height);
						ctx.fillStyle = bandColor(b.deployment_id, 0.85);
						ctx.fillRect(x0, top, x1 - x0, BAND_TOP_STRIP);
					}
					ctx.restore();
				},
			],
		},
	};
}

/** Vertical dashed markers at each calibration valid_from. */
export function calibrationMarkerPlugin(
	markersRef: { current: CalibrationMarker[] },
	visRef: { current: OverlayVisibility },
): uPlot.Plugin {
	return {
		hooks: {
			draw: [
				(u: uPlot) => {
					if (!visRef.current.calibrationMarkers) return;
					const markers = markersRef.current;
					if (!markers.length) return;
					const ctx = u.ctx;
					const { left, top, width, height } = u.bbox;
					ctx.save();
					ctx.beginPath();
					ctx.rect(left, top, width, height + 4);
					ctx.clip();
					ctx.strokeStyle = tokens.brand.accent;
					ctx.lineWidth = 1;
					ctx.setLineDash([4, 3]);
					for (const m of markers) {
						const ts = new Date(m.valid_from).getTime() / 1000;
						const x = u.valToPos(ts, 'x', true);
						if (x < left || x > left + width) continue;
						ctx.beginPath();
						ctx.moveTo(x, top);
						ctx.lineTo(x, top + height);
						ctx.stroke();
					}
					ctx.restore();
				},
			],
		},
	};
}

/** Hit-test: which band contains an x timestamp (seconds), for hover → config link. */
export function bandAtTime(bands: SensorIdentityBand[], tsSec: number): SensorIdentityBand | null {
	for (const b of bands) {
		const t0 = new Date(b.from).getTime() / 1000;
		const t1 = b.until ? new Date(b.until).getTime() / 1000 : Infinity;
		if (tsSec >= t0 && tsSec < t1) return b;
	}
	return null;
}
