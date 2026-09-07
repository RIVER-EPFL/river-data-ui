import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import { groupSubscribed } from "$lib/notifications/groups";

const NotificationGroups = (await import("./NotificationGroups.svelte"))
  .default;

describe("NotificationGroups", () => {
  it("renders the sync group unsubscribed and the alarm group subscribed with no rows present", () => {
    render(NotificationGroups, {
      subscribed: {
        alarms: groupSubscribed([], "alarms"),
        sync: groupSubscribed([], "sync"),
      },
    });
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });

  it("says what each group sends and which way it defaults", () => {
    const { container } = render(NotificationGroups, {
      subscribed: { alarms: true, sync: false },
    });
    expect(container.textContent).toContain("crossing a threshold");
    expect(container.textContent).toContain("On unless you turn it off.");
    expect(container.textContent).toContain("sync service falling silent");
    expect(container.textContent).toContain("Off unless you turn it on.");
  });
});
