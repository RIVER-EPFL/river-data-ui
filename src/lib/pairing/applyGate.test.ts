import { describe, expect, it } from "vitest";

import { applyBlockedReason, gateBlocking, planGateItems } from "./applyGate";
import type { PlanGate } from "./applyGate";

describe("applyBlockedReason", () => {
  it("allows the apply when nothing is outstanding", () => {
    expect(
      applyBlockedReason({ needsChecking: 0, selfValidated: 0, openInstrumentQuestions: 0 }),
    ).toBeNull();
  });

  it("refuses while any row still needs checking", () => {
    expect(
      applyBlockedReason({ needsChecking: 1679, selfValidated: 0, openInstrumentQuestions: 0 }),
    ).toContain("1679 rows still to tick");
  });

  it("refuses while a self-validated row is unticked, a tick being a record that a person looked", () => {
    expect(
      applyBlockedReason({ needsChecking: 0, selfValidated: 20, openInstrumentQuestions: 0 }),
    ).toContain("20 rows still to tick");
    expect(
      applyBlockedReason({ needsChecking: 3, selfValidated: 2, openInstrumentQuestions: 0 }),
    ).toContain("5 rows still to tick");
  });

  it("names the instruments first, being the nearer fix", () => {
    expect(
      applyBlockedReason({ needsChecking: 12, selfValidated: 0, openInstrumentQuestions: 2 }),
    ).toContain("2 instruments still to decide");
  });

  it("reads singular for one of each", () => {
    expect(
      applyBlockedReason({ needsChecking: 0, selfValidated: 0, openInstrumentQuestions: 1 }),
    ).toContain("1 instrument still to decide");
    expect(
      applyBlockedReason({ needsChecking: 1, selfValidated: 0, openInstrumentQuestions: 0 }),
    ).toContain("1 row still to tick");
  });
});

describe("planGateItems", () => {
  const cnet: PlanGate = {
    objects: { accepted: 0, total: 124 },
    instruments: { decided: 0, total: 92 },
    rows: { ticked: 0, total: 2852 },
    unitConflicts: 0,
  };

  it("states each gate as a count, a state and the tab that settles it", () => {
    expect(planGateItems(cnet)).toEqual([
      { key: "objects", label: "Objects", detail: "0 of 124 accepted", state: "blocking", tab: "objects" },
      { key: "instruments", label: "Instruments", detail: "0 of 92 decided", state: "blocking", tab: "instruments" },
      { key: "rows", label: "Rows", detail: "0 of 2,852 ticked", state: "blocking", tab: "sites" },
    ]);
  });

  it("turns a gate to done once its count is complete, leaving Apply on the rest", () => {
    const settled = planGateItems({ ...cnet, objects: { accepted: 124, total: 124 } });
    expect(settled.find((i) => i.key === "objects")?.state).toBe("done");
    expect(gateBlocking(settled).map((i) => i.key)).toEqual(["instruments", "rows"]);
  });

  it("clears the blocking list when every count is complete", () => {
    const done = planGateItems({
      objects: { accepted: 124, total: 124 },
      instruments: { decided: 92, total: 92 },
      rows: { ticked: 2852, total: 2852 },
      unitConflicts: 0,
    });
    expect(gateBlocking(done)).toEqual([]);
    expect(done.every((i) => i.state === "done")).toBe(true);
  });

  it("leaves out a gate with nothing behind it", () => {
    const items = planGateItems({
      objects: { accepted: 0, total: 0 },
      instruments: { decided: 0, total: 0 },
      rows: { ticked: 4, total: 9 },
      unitConflicts: 3,
    });
    expect(items.map((i) => i.key)).toEqual(["rows", "units"]);
  });
});
