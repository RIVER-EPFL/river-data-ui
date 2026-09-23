import { describe, expect, it } from "vitest";

import { instrumentCurves } from "./instrument";

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
