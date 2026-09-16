import { describe, expect, it } from "vitest";

import { deepLinkParameter, visitHref } from "./link";

const siteParameters = [
  { id: "sp-doc", parameter_id: "doc" },
  { id: "sp-ph", parameter_id: "ph" },
];

describe("visitHref", () => {
  it("opens the visit alone when no parameter is named", () => {
    expect(visitHref("site", "event")).toBe(
      "/sites/site?tab=visits&event=event",
    );
  });

  it("names the parameter the visit opens on", () => {
    expect(visitHref("site", "event", "doc")).toBe(
      "/sites/site?tab=visits&event=event&parameter=doc",
    );
  });
});

describe("deepLinkParameter", () => {
  it("reads a parameter the site reports", () => {
    expect(
      deepLinkParameter(new URLSearchParams("parameter=doc"), siteParameters),
    ).toBe("doc");
  });

  it("reads a site parameter as its parameter", () => {
    expect(
      deepLinkParameter(new URLSearchParams("point=sp-ph"), siteParameters),
    ).toBe("ph");
  });

  it("names nothing for a parameter the site does not report", () => {
    expect(
      deepLinkParameter(new URLSearchParams("parameter=other"), siteParameters),
    ).toBeNull();
    expect(
      deepLinkParameter(new URLSearchParams("point=sp-other"), siteParameters),
    ).toBeNull();
  });

  it("names nothing without either key", () => {
    expect(
      deepLinkParameter(new URLSearchParams("event=e"), siteParameters),
    ).toBeNull();
  });
});
