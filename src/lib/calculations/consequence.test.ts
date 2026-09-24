import { describe, expect, it } from "vitest";

import type { ToolVersionUsage } from "$api/service";
import { storedLabel, versionConsequence } from "./consequence";

const usage = (over: Partial<ToolVersionUsage> = {}): ToolVersionUsage => ({
  version_id: "v",
  version_no: 3,
  visits: 87,
  readings: 412,
  ...over,
});

describe("storedLabel", () => {
  it("counts the readings and the visits they sit at", () => {
    expect(storedLabel(usage())).toBe("412 readings at 87 visits");
  });

  it("says nothing stored rather than zero readings", () => {
    expect(storedLabel(usage({ readings: 0, visits: 0 }))).toBe(
      "nothing stored",
    );
  });

  it("is singular on one reading at one visit", () => {
    expect(storedLabel(usage({ readings: 1, visits: 1 }))).toBe(
      "1 reading at 1 visit",
    );
  });
});

describe("versionConsequence", () => {
  it("names the version and says what it produced is computed again", () => {
    const message = versionConsequence(usage());
    expect(message).toContain("Version 3 produced 412 readings at 87 visits");
    expect(message).toContain("computed again under the new one");
    expect(message).not.toContain("leaves them there");
  });

  it("says nothing is recomputed when the version produced nothing", () => {
    expect(versionConsequence(usage({ readings: 0, visits: 0 }))).toBe(
      "Version 3 has produced nothing stored yet, so nothing is recomputed.",
    );
  });

  it("claims no count before the counts arrive", () => {
    const message = versionConsequence(undefined);
    expect(message).not.toMatch(/\d/);
    expect(message).toContain("computed again under the new one");
  });
});
