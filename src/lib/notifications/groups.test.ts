import { describe, expect, it } from "vitest";
import { groupSubscribed, subscriptionRows } from "./groups";

describe("notification groups", () => {
  it("reads the alarm group as subscribed and the sync group as not, with no rows", () => {
    expect(groupSubscribed([], "alarms")).toBe(true);
    expect(groupSubscribed([], "sync")).toBe(false);
  });

  it("lets a group-wide row override its default in both directions", () => {
    const rows = [
      { kind_group: "alarms" as const, enabled: false },
      { kind_group: "sync" as const, enabled: true },
    ];
    expect(groupSubscribed(rows, "alarms")).toBe(false);
    expect(groupSubscribed(rows, "sync")).toBe(true);
  });

  it("ignores a scoped row when reading the group-wide state", () => {
    const rows = [
      { kind_group: "alarms" as const, site_id: "site-1", enabled: false },
    ];
    expect(groupSubscribed(rows, "alarms")).toBe(true);
  });

  it("treats a row with no group as an alarm row, as the API does", () => {
    expect(groupSubscribed([{ enabled: false }], "alarms")).toBe(false);
  });

  it("writes no row for a group left at its default", () => {
    expect(subscriptionRows({ alarms: true, sync: false }, [])).toEqual([]);
  });

  it("writes one row per group that departs from its default", () => {
    expect(subscriptionRows({ alarms: false, sync: true }, [])).toEqual([
      { kind_group: "alarms", enabled: false },
      { kind_group: "sync", enabled: true },
    ]);
  });

  it("scopes the muted sites to the alarm group", () => {
    expect(subscriptionRows({ alarms: true, sync: true }, ["site-1"])).toEqual([
      { kind_group: "sync", enabled: true },
      { kind_group: "alarms", site_id: "site-1", enabled: false },
    ]);
  });

  it("round-trips a saved state", () => {
    const saved = subscriptionRows({ alarms: true, sync: true }, ["site-1"]);
    expect(groupSubscribed(saved, "sync")).toBe(true);
    expect(groupSubscribed(saved, "alarms")).toBe(true);
  });
});
