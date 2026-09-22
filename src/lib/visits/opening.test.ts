import { describe, expect, it } from "vitest";
import { visitToOpen } from "./opening";

const visits = [
  { id: "newest-empty", parameters_filled: 0 },
  { id: "filled", parameters_filled: 3 },
  { id: "older-filled", parameters_filled: 1 },
];

describe("visitToOpen", () => {
  it("takes the latest visit carrying values", () => {
    expect(visitToOpen(visits)).toBe("filled");
  });

  it("keeps the visit a link named", () => {
    expect(visitToOpen(visits, "older-filled")).toBe("older-filled");
  });

  it("falls back to the latest when the site no longer holds the named one", () => {
    expect(visitToOpen(visits, "gone")).toBe("filled");
  });

  it("takes the latest visit when none carries values", () => {
    expect(
      visitToOpen([
        { id: "a", parameters_filled: 0 },
        { id: "b", parameters_filled: 0 },
      ]),
    ).toBe("a");
  });

  it("chooses nothing at a site with no visits", () => {
    expect(visitToOpen([])).toBe("");
  });
});
