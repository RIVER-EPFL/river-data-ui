/** Shared time-range utilities used by all chart components. */

export const TIME_RANGE_PRESETS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * Resolve aggregation level based on time span.
 * Thresholds match dashboard-engine.ts for consistency:
 *   ≤14 days → raw, ≤120 days → hourly, ≤1095 days → daily, else weekly
 */
export function resolveAggregation(
  spanMs: number,
): 'raw' | 'hourly' | 'daily' | 'weekly' {
  const days = spanMs / (24 * 60 * 60 * 1000);
  if (days <= 14) return 'raw';
  if (days <= 120) return 'hourly';
  if (days <= 1095) return 'daily';
  return 'weekly';
}

export function formatDuration(ms: number): string {
  const days = Math.round(ms / 86400000);
  if (days < 1) return 'Less than 1 day';
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days < 30) return `${Math.round(days / 7)} week${days >= 14 ? 's' : ''}`;
  if (days < 365) return `${Math.round(days / 30)} month${days >= 60 ? 's' : ''}`;
  return `${(days / 365).toFixed(1)} years`;
}

export function formatDateTimeFull(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
