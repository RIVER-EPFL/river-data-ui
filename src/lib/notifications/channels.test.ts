import { describe, expect, it } from "vitest";
import type { NotificationChannelView } from "$api/service";
import { channelSubscribed, frequencyPreview, subscriptionRows } from "./channels";

function channel(
  kind: string,
  onByDefault: boolean,
  counts: [number, number, number] = [0, 0, 0],
): NotificationChannelView {
  const [sent1d, sent7d, sent30d] = counts;
  return {
    kind,
    label: kind,
    description: "",
    onByDefault,
    subscribed: onByDefault,
    sent1d,
    sent7d,
    sent30d,
  };
}

const CHANNELS = [
  channel("alarm_opened", true),
  channel("alarm_resolved", true),
  channel("curve_drift", false),
  channel("battery_forecast", false),
];

describe("notification channels", () => {
  it("reads the alarm channels as subscribed and the opt-in ones as not, with no rows", () => {
    expect(channelSubscribed([], "alarm_opened", true)).toBe(true);
    expect(channelSubscribed([], "curve_drift", false)).toBe(false);
  });

  it("lets a channel-wide row override its default in both directions", () => {
    const rows = [
      { channel: "alarm_opened", enabled: false },
      { channel: "curve_drift", enabled: true },
    ];
    expect(channelSubscribed(rows, "alarm_opened", true)).toBe(false);
    expect(channelSubscribed(rows, "curve_drift", false)).toBe(true);
  });

  it("answers per kind, so one channel's choice does not carry to its neighbour", () => {
    const rows = [{ channel: "curve_drift", enabled: true }];
    expect(channelSubscribed(rows, "curve_drift", false)).toBe(true);
    expect(channelSubscribed(rows, "derived_computed", false)).toBe(false);
  });

  it("ignores a scoped row when reading the channel-wide state", () => {
    const rows = [{ channel: "alarm_opened", site_id: "site-1", enabled: false }];
    expect(channelSubscribed(rows, "alarm_opened", true)).toBe(true);
  });

  it("writes no row for a channel left at its default", () => {
    expect(subscriptionRows(CHANNELS, {}, [])).toEqual([]);
  });

  it("writes one row per channel that departs from its default", () => {
    expect(
      subscriptionRows(CHANNELS, { alarm_opened: false, curve_drift: true }, []),
    ).toEqual([
      { channel: "alarm_opened", enabled: false },
      { channel: "curve_drift", enabled: true },
    ]);
  });

  it("mutes a site on every site-scoped channel", () => {
    expect(subscriptionRows(CHANNELS, {}, ["site-1"])).toEqual([
      { channel: "alarm_opened", site_id: "site-1", enabled: false },
      { channel: "alarm_resolved", site_id: "site-1", enabled: false },
    ]);
  });

  it("round-trips a saved state", () => {
    const saved = subscriptionRows(CHANNELS, { curve_drift: true }, ["site-1"]);
    expect(channelSubscribed(saved, "curve_drift", false)).toBe(true);
    expect(channelSubscribed(saved, "alarm_opened", true)).toBe(true);
  });

  it("says plainly when a channel has sent nothing", () => {
    expect(frequencyPreview(channel("curve_drift", false))).toBe(
      "Nothing sent in the last 30 days.",
    );
    expect(frequencyPreview(channel("curve_drift", false, [1, 4, 9]))).toContain(
      "9 in the last 30 days",
    );
  });
});
