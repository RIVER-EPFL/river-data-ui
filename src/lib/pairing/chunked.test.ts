import { describe, expect, it } from "vitest";

import { chunked } from "./chunked";

describe("chunked", () => {
  it("splits into requests of at most the size, keeping order", () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 2)).toEqual([]);
  });
});
