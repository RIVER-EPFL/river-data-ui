import type { MySubscriptionScope, NotificationChannelView } from "$api/service";

/** The channels whose scope is a site, so the site tree hangs under them. */
export const SITE_SCOPED_CHANNELS = ["alarm_opened", "alarm_resolved"];

function isChannelWide(scope: MySubscriptionScope): boolean {
  return !scope.project_id && !scope.site_id && !scope.parameter_id;
}

/** Whether the caller is in a channel's audience. With no row the channel's own default stands. */
export function channelSubscribed(
  subscriptions: MySubscriptionScope[],
  kind: string,
  onByDefault: boolean,
): boolean {
  const row = subscriptions.find((s) => s.channel === kind && isChannelWide(s));
  return row ? row.enabled : onByDefault;
}

/**
 * The rows to save for a chosen state and a set of muted sites. A channel left at its own default
 * writes no row, which is what keeps a subscriber who never opened this page in the same audience
 * as one who opened it and changed nothing. A muted site is muted for every site-scoped channel.
 */
export function subscriptionRows(
  channels: NotificationChannelView[],
  subscribed: Record<string, boolean>,
  mutedSites: Iterable<string>,
): MySubscriptionScope[] {
  const rows: MySubscriptionScope[] = [];
  for (const channel of channels) {
    const chosen = subscribed[channel.kind] ?? channel.onByDefault;
    if (chosen !== channel.onByDefault) {
      rows.push({ channel: channel.kind, enabled: chosen });
    }
  }
  for (const site_id of mutedSites) {
    for (const kind of SITE_SCOPED_CHANNELS) {
      rows.push({ channel: kind, site_id, enabled: false });
    }
  }
  return rows;
}

/** How often a channel has fired, in the words the preview shows. */
export function frequencyPreview(channel: NotificationChannelView): string {
  const { sent1d, sent7d, sent30d } = channel;
  if (sent30d === 0) return "Nothing sent in the last 30 days.";
  return `${sent1d} in the last day, ${sent7d} in the last week, ${sent30d} in the last 30 days.`;
}
