import { describe, expect, it } from "vitest";

import { applyBlockedReason, gateBlocking, planGateItems } from "./applyGate";
import type { PlanGate } from "./applyGate";

const cnet: PlanGate = {
  projects: { reviewed: 0, total: 1 },
  sites: { reviewed: 0, total: 31 },
  parameters: { reviewed: 0, total: 23 },
  instruments: { reviewed: 0, total: 92 },
  curves: { reviewed: 0, total: 14 },
};

describe("planGateItems", () => {
  it("states every review tab as a review count and a state", () => {
    expect(planGateItems(cnet)).toEqual([
      { tab: "projects", label: "Projects", detail: "0 of 1 reviewed", state: "blocking", conflicts: [] },
      { tab: "sites", label: "Sites", detail: "0 of 31 reviewed", state: "blocking", conflicts: [] },
      { tab: "parameters", label: "Parameters", detail: "0 of 23 reviewed", state: "blocking", conflicts: [] },
      { tab: "instruments", label: "Instruments", detail: "0 of 92 reviewed", state: "blocking", conflicts: [] },
      { tab: "curves", label: "Standard curves", detail: "0 of 14 reviewed", state: "blocking", conflicts: [] },
    ]);
  });

  it("turns a tab to done once everything on it is reviewed, leaving Apply on the rest", () => {
    const items = planGateItems({ ...cnet, projects: { reviewed: 1, total: 1 } });
    expect(items[0]?.state).toBe("done");
    expect(gateBlocking(items).map((i) => i.tab)).toEqual(["sites", "parameters", "instruments", "curves"]);
  });

  it("states no review on a tab with nothing on it", () => {
    const items = planGateItems({ ...cnet, instruments: { reviewed: 0, total: 0 } });
    expect(items.find((i) => i.tab === "instruments")).toMatchObject({ detail: "0", state: "none" });
  });
});

describe("applyBlockedReason", () => {
  it("names each tab still to review", () => {
    const items = planGateItems({ ...cnet, projects: { reviewed: 1, total: 1 }, instruments: { reviewed: 92, total: 92 }, curves: { reviewed: 14, total: 14 } });
    expect(applyBlockedReason(items)).toBe(
      "Still to review: Sites (0 of 31 reviewed), Parameters (0 of 23 reviewed)",
    );
  });

  it("allows the apply once every tab is reviewed", () => {
    const all = (total: number) => ({ reviewed: total, total });
    expect(
      applyBlockedReason(
        planGateItems({ projects: all(1), sites: all(31), parameters: all(23), instruments: all(92), curves: all(14) }),
      ),
    ).toBeNull();
  });
});

describe("a conflict on a reviewed tab", () => {
  const all = (total: number) => ({ reviewed: total, total });
  const reviewed: PlanGate = {
    projects: all(1),
    sites: all(31),
    parameters: all(23),
    instruments: all(92),
    curves: all(14),
  };

  // Ticking the two rows that share a code says a person looked at them; it does not make one code
  // two parameters.
  it("keeps Apply shut and says what has to change", () => {
    const items = planGateItems({
      ...reviewed,
      conflicts: { parameters: ["'DO' is proposed with 2 sets of units (uM, degC)."] },
    });
    expect(items.find((i) => i.tab === "parameters")).toMatchObject({
      state: "blocking",
      detail: "1 to resolve",
    });
    expect(applyBlockedReason(items)).toBe(
      "To resolve first: 'DO' is proposed with 2 sets of units (uM, degC).",
    );
  });
});
