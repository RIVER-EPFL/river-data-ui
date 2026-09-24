import { describe, expect, it } from "vitest";

import type { EventCell } from "$api/service";

import { instrumentCurves, rowInstrument } from "./instrument";

describe("instrumentCurves", () => {
  it("names an instrument's curves and links to them", () => {
    expect(instrumentCurves("sensor-1", 2)).toEqual({
      label: "2 curves",
      href: "/sensors/sensor-1?tab=curves",
    });
  });

  it("says an instrument with no curve serves its values uncorrected", () => {
    expect(instrumentCurves("sensor-1", 0)).toEqual({
      label: "no curves, served uncorrected",
      href: "/sensors/sensor-1?tab=curves",
    });
  });

  it("offers nothing for a cell that declares no instrument", () => {
    expect(instrumentCurves("", 3)).toBeNull();
    expect(instrumentCurves(null, null)).toBeNull();
  });
});

describe("rowInstrument", () => {
  const sensor = { id: "sensor-1", name: "A_T", serial_number: "SN-7" };
  const measured = (over: Partial<EventCell> = {}): EventCell =>
    ({
      parameter_id: "p",
      parameter_code: "p",
      parameter_name: "p",
      stream_id: "stream-1",
      origin: "sync",
      has_provenance: false,
      computed_curves: [],
      replicates: [{ replicate_index: 0, raw_value: 1 }],
      record: {
        origin: { stream_id: "stream-1", source_system: "cnet", source_key: "FP11:A_T", classification: "sync" },
        readings: [],
        chain: { sensor },
        holds: [],
      },
      ...over,
    }) as EventCell;

  it("names the instrument a synced value was measured on", () => {
    expect(rowInstrument(measured())).toEqual({ kind: "measured", label: "A_T", sensorId: "sensor-1" });
  });

  it("names the instrument a hand-entered value was measured on, by serial when unnamed", () => {
    const cell = measured({ origin: "manual" });
    cell.record!.chain.sensor = { id: "sensor-2", serial_number: "SN-9" };
    expect(rowInstrument(cell)).toEqual({ kind: "measured", label: "SN-9", sensorId: "sensor-2" });
  });

  it("says nothing of an instrument where the record names none", () => {
    expect(rowInstrument(measured({ record: undefined }))).toEqual({
      kind: "measured",
      label: null,
      sensorId: null,
    });
  });

  it("names the calculation behind a computed value", () => {
    expect(rowInstrument(measured({ written_by: "abstar" }))).toEqual({
      kind: "computed",
      calculation: "abstar",
    });
  });

  it("leaves a parameter the visit did not measure to the next entry", () => {
    expect(rowInstrument(null)).toEqual({ kind: "entry" });
    expect(rowInstrument(measured({ replicates: [], record: undefined }))).toEqual({ kind: "entry" });
  });
});
