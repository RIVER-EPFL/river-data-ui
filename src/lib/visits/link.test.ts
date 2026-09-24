import { describe, expect, it } from "vitest";

import { deepLinkParameter, visitHref, writeVisitParams } from "./link";

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

describe("writeVisitParams", () => {
  function written(search: string, event: string | null, parameter: string | null) {
    const params = new URLSearchParams(search);
    writeVisitParams(params, event, parameter);
    return params.toString();
  }

  it("names the open visit and its record beside the tab", () => {
    expect(written("tab=visits", "e1", "doc")).toBe(
      "tab=visits&event=e1&parameter=doc",
    );
  });

  it("names the visit alone when no record is open", () => {
    expect(written("tab=visits&event=e0&parameter=doc", "e1", null)).toBe(
      "tab=visits&event=e1",
    );
  });

  it("drops the visit and its record when the visit closes", () => {
    expect(written("tab=visits&event=e1&parameter=doc", null, null)).toBe(
      "tab=visits",
    );
  });

  it("replaces a site-parameter link with the parameter it resolved to", () => {
    expect(written("tab=visits&event=e1&point=sp-doc", "e1", "doc")).toBe(
      "tab=visits&event=e1&parameter=doc",
    );
  });
});
