import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getNotificationsHealth = vi.fn();
vi.mock("$api/service", () => ({
  getNotificationsHealth: () => getNotificationsHealth(),
}));

const NotificationHealthNotice = (
  await import("./NotificationHealthNotice.svelte")
).default;

function health(over: Record<string, unknown> = {}) {
  return {
    channels: [
      {
        name: "web_push",
        available: true,
        healthy: true,
        detail: null,
        checkedAt: null,
      },
    ],
    noChannelConfigured: false,
    undeliverable24h: 0,
    failed24h: 0,
    ...over,
  };
}

describe("NotificationHealthNotice", () => {
  beforeEach(() => getNotificationsHealth.mockReset());

  it("says nothing when a channel is configured and healthy", async () => {
    getNotificationsHealth.mockResolvedValue(health());
    const { container } = render(NotificationHealthNotice, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getNotificationsHealth).toHaveBeenCalled();
    expect(container.textContent?.trim()).toBe("");
  });

  it("names the missing channel and says ingestion is unaffected", async () => {
    getNotificationsHealth.mockResolvedValue(
      health({ noChannelConfigured: true, channels: [], undeliverable24h: 12 }),
    );
    render(NotificationHealthNotice, {});
    expect(
      await screen.findByText(/No notification channel is configured/),
    ).toBeTruthy();
    expect(screen.getByText(/Ingestion is unaffected/)).toBeTruthy();
  });

  it("reports a configured channel whose last probe failed", async () => {
    getNotificationsHealth.mockResolvedValue(
      health({
        channels: [
          {
            name: "web_push",
            available: true,
            healthy: false,
            detail: "bad key",
            checkedAt: null,
          },
        ],
      }),
    );
    render(NotificationHealthNotice, {});
    expect(await screen.findByText(/web_push/)).toBeTruthy();
    expect(screen.getByText(/bad key/)).toBeTruthy();
  });

  // The counts are the only signal that healthy channels still reached nobody.
  it("reports deliveries that reached nobody when every channel looks healthy", async () => {
    getNotificationsHealth.mockResolvedValue(
      health({ undeliverable24h: 2, failed24h: 3 }),
    );
    render(NotificationHealthNotice, {});
    expect(
      await screen.findByText(/5 notifications reached nobody/),
    ).toBeTruthy();
  });

  it("does not fetch when the viewer may not read the endpoint", async () => {
    render(NotificationHealthNotice, { enabled: false });
    expect(getNotificationsHealth).not.toHaveBeenCalled();
  });
});
