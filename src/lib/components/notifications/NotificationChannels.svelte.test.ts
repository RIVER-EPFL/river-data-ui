import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { NotificationChannelView } from "$api/service";
import { channelSubscribed } from "$lib/notifications/channels";

const NotificationChannels = (await import("./NotificationChannels.svelte"))
  .default;

const CHANNELS: NotificationChannelView[] = [
  {
    kind: "alarm_opened",
    label: "Alarm opened",
    description: "A reading crossing a warning or alarm threshold.",
    onByDefault: true,
    subscribed: true,
    sent1d: 2,
    sent7d: 9,
    sent30d: 31,
  },
  {
    kind: "curve_drift",
    label: "Recomposed values",
    description: "Stored values the janitor recomposed.",
    onByDefault: false,
    subscribed: false,
    sent1d: 0,
    sent7d: 0,
    sent30d: 0,
  },
];

describe("NotificationChannels", () => {
  it("renders each channel at its own default when no row chooses otherwise", () => {
    render(NotificationChannels, {
      channels: CHANNELS,
      subscribed: Object.fromEntries(
        CHANNELS.map((c) => [c.kind, channelSubscribed([], c.kind, c.onByDefault)]),
      ),
    });
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it("says what each channel sends, which way it defaults, and how often it has fired", () => {
    const { container } = render(NotificationChannels, {
      channels: CHANNELS,
      subscribed: { alarm_opened: true, curve_drift: false },
    });
    expect(container.textContent).toContain("crossing a warning or alarm threshold");
    expect(container.textContent).toContain("On unless you turn it off.");
    expect(container.textContent).toContain("31 in the last 30 days");
    expect(container.textContent).toContain("Off unless you turn it on.");
    expect(container.textContent).toContain("Nothing sent in the last 30 days.");
  });
});
