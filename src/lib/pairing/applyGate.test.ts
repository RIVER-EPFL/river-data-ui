import { describe, expect, it } from "vitest";

import { applyBlockedReason } from "./applyGate";

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
