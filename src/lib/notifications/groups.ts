import type { MySubscriptionScope } from "$api/service";

export type NotificationGroupId = "alarms" | "sync";

export interface NotificationGroup {
  id: NotificationGroupId;
  label: string;
  /** What the group sends, so the choice is made from the alerts and not from the name. */
  description: string;
  /** Whether a subscriber with no row for this group is in its audience. */
  subscribedWithoutARow: boolean;
}

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    id: "alarms",
    label: "Alarms and warnings",
    description:
      "A reading crossing a threshold, its return to range, and a battery running low.",
    subscribedWithoutARow: true,
  },
  {
    id: "sync",
    label: "Sync and staleness",
    description:
      "A sync service falling silent or failing, and a site that stops sending data.",
    subscribedWithoutARow: false,
  },
];

function groupOf(scope: MySubscriptionScope): NotificationGroupId {
  return scope.kind_group === "sync" ? "sync" : "alarms";
}

function isGroupWide(scope: MySubscriptionScope): boolean {
  return !scope.project_id && !scope.site_id && !scope.parameter_id;
}

/** Whether the caller is in a group's audience. With no row the group's own default stands. */
export function groupSubscribed(
  subscriptions: MySubscriptionScope[],
  id: NotificationGroupId,
): boolean {
  const row = subscriptions.find((s) => groupOf(s) === id && isGroupWide(s));
  if (row) return row.enabled;
  return (
    NOTIFICATION_GROUPS.find((g) => g.id === id)?.subscribedWithoutARow ?? true
  );
}

/**
 * The rows to save for a chosen group state and a set of muted sites. A group left at its own
 * default writes no row, which is what keeps a subscriber who never opened this page in the same
 * audience as one who opened it and changed nothing.
 */
export function subscriptionRows(
  subscribed: Record<NotificationGroupId, boolean>,
  mutedSites: Iterable<string>,
): MySubscriptionScope[] {
  const rows: MySubscriptionScope[] = [];
  for (const group of NOTIFICATION_GROUPS) {
    if (subscribed[group.id] !== group.subscribedWithoutARow) {
      rows.push({ kind_group: group.id, enabled: subscribed[group.id] });
    }
  }
  for (const site_id of mutedSites) {
    rows.push({ kind_group: "alarms", site_id, enabled: false });
  }
  return rows;
}
