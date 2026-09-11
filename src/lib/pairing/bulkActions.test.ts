import { describe, expect, it } from "vitest";

import type { PairingPlanEntry } from "$api/service";
import { bulkUpdates } from "./bulkActions";

function entry(over: Partial<PairingPlanEntry> = {}): PairingPlanEntry {
  return {
    stream_id: "stream",
    source_key: "STA:Depth",
    source_name: null,
    action: "pair",
    acknowledged: false,
    project: { id: "p", name: "BREATHE", create: false },
    site: {
      id: "s",
      name: "Martigny",
      create: false,
      latitude: null,
      longitude: null,
      altitude_m: null,
    },
    parameter: {
      id: "par",
      name: "Depth",
      label: null,
      create: false,
      units: "mm",
      group_key: null,
      original_names: [],
    },
    confidence: "exact",
    warnings: [],
    original_parameter_name: null,
    replicates: null,
    instrument: null,
    ...over,
  } as PairingPlanEntry;
}

const instrument = (id: string) => ({
  id,
  name: "TOC analyser",
  create: false,
  confirmed: true,
});

describe("bulkUpdates", () => {
  it("writes one update per selected row and leaves the rest alone", () => {
    const entries = [
      entry({ stream_id: "a" }),
      entry({ stream_id: "b" }),
      entry({ stream_id: "c" }),
    ];
    const updates = bulkUpdates(entries, new Set(["a", "c"]), {
      field: "acknowledged",
      value: true,
    });
    expect(updates).toEqual([
      { stream_id: "a", acknowledged: true },
      { stream_id: "c", acknowledged: true },
    ]);
  });

  it("sends the rows in plan order, not selection order", () => {
    const entries = [entry({ stream_id: "a" }), entry({ stream_id: "b" })];
    const updates = bulkUpdates(entries, new Set(["b", "a"]), {
      field: "action",
      value: "skip",
    });
    expect(updates.map((u) => u.stream_id)).toEqual(["a", "b"]);
  });

  it("leaves out rows the decision would not move", () => {
    const entries = [
      entry({ stream_id: "a", acknowledged: true }),
      entry({ stream_id: "b", acknowledged: false }),
    ];
    const updates = bulkUpdates(entries, new Set(["a", "b"]), {
      field: "acknowledged",
      value: true,
    });
    expect(updates).toEqual([{ stream_id: "b", acknowledged: true }]);
  });

  it("ignores selected stream ids the plan no longer carries", () => {
    const updates = bulkUpdates(
      [entry({ stream_id: "a" })],
      new Set(["a", "gone"]),
      {
        field: "action",
        value: "skip",
      },
    );
    expect(updates).toEqual([{ stream_id: "a", action: "skip" }]);
  });

  it("clears an estimator with the empty string rather than dropping the field", () => {
    const entries = [
      entry({
        stream_id: "a",
        sd_estimator: "sample",
      } as Partial<PairingPlanEntry>),
    ];
    const updates = bulkUpdates(entries, new Set(["a"]), {
      field: "sd_estimator",
      value: "",
    });
    expect(updates).toEqual([{ stream_id: "a", sd_estimator: "" }]);
  });

  it("attaches an instrument only where a different one, or none, is bound", () => {
    const entries = [
      entry({
        stream_id: "a",
        instrument: instrument("toc"),
      } as Partial<PairingPlanEntry>),
      entry({
        stream_id: "b",
        instrument: instrument("other"),
      } as Partial<PairingPlanEntry>),
      entry({ stream_id: "c" }),
    ];
    const updates = bulkUpdates(entries, new Set(["a", "b", "c"]), {
      field: "instrument_id",
      value: "toc",
    });
    expect(updates).toEqual([
      { stream_id: "b", instrument_id: "toc" },
      { stream_id: "c", instrument_id: "toc" },
    ]);
  });

  it("detaches only the rows that carry an instrument", () => {
    const entries = [
      entry({
        stream_id: "a",
        instrument: instrument("toc"),
      } as Partial<PairingPlanEntry>),
      entry({ stream_id: "b" }),
    ];
    const updates = bulkUpdates(entries, new Set(["a", "b"]), {
      field: "instrument_clear",
    });
    expect(updates).toEqual([{ stream_id: "a", instrument_clear: true }]);
  });

  it("sends nothing when the selection is empty", () => {
    expect(
      bulkUpdates([entry()], new Set(), { field: "action", value: "skip" }),
    ).toEqual([]);
  });
});
