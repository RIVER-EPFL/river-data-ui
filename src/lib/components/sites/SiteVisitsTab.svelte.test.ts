import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSiteVisits = vi.fn();
vi.mock("$api/service", () => ({
  listSiteVisits: (siteId: string, range: unknown) =>
    listSiteVisits(siteId, range),
  getCollectionEventDetail: vi.fn(),
  recomputeCollectionEvent: vi.fn(),
  runEventAudit: vi.fn(),
  runEventRecompute: vi.fn(),
  pollJob: vi.fn(),
}));

const SiteVisitsTab = (await import("./SiteVisitsTab.svelte")).default;

// A single-precision 100.8 as the portals store it, so what the grid prints is a display
// decision rather than an artefact of the number.
const STORED = 100.8000030517578;

const column = (id: string, code: string, decimals: number | null) => ({
  parameter_id: id,
  code,
  name: code,
  units: "mg/L",
  decimal_places: decimals,
});

const cell = (id: string) => ({
  parameter_id: id,
  value: STORED,
  n: 1,
  n_total: 1,
  n_flagged: 0,
  n_withdrawn: 0,
  flagged: false,
  withdrawn: false,
  finding: null,
  finding_count: 0,
  stdev: null,
  median: null,
  min: null,
  max: null,
  sd_estimator: null,
  sd_estimator_source: null,
});

const props = (declared: Record<string, number | null>) => ({
  siteId: "site-1",
  siteName: "FP15",
  siteParameters: [],
  active: true,
  paramName: (id: string) => id,
  unitsForParameter: () => "mg/L",
  decimalsForParameter: (id: string) => declared[id] ?? null,
  visitPointLink: () => "#",
  onFlag: () => {},
  onDataChanged: () => {},
});

beforeEach(() => vi.clearAllMocks());

describe("SiteVisitsTab", () => {
  it("renders a cell at the precision its slot declares, and an undeclared one as measured", async () => {
    listSiteVisits.mockResolvedValue({
      site_id: "site-1",
      page: 1,
      page_size: 50,
      total: 1,
      expected_parameters: [
        column("declared", "DOC", 2),
        column("undeclared", "TURB", null),
      ],
      visits: [
        {
          id: "visit-1",
          collected_at: "2025-06-01T08:00:00Z",
          created_by: "tester",
          source: "manual",
          notes: null,
          parameters_filled: 2,
          findings_open: 0,
          recompute: "current",
          cells: [cell("declared"), cell("undeclared")],
        },
      ],
    });

    render(SiteVisitsTab, props({ declared: 2, undeclared: null }));

    // The declaration the lab made is what the grid shows.
    expect(await screen.findByText("100.80")).toBeTruthy();
    // A slot nobody declared for is not rounded to a precision nobody chose.
    expect(screen.getByText("100.8")).toBeTruthy();
    expect(screen.queryByText("100.800003")).toBeNull();
  });

  it("tells a portal-synced visit that no calculation runs there", async () => {
    listSiteVisits.mockResolvedValue({
      site_id: "site-1",
      page: 1,
      page_size: 50,
      total: 2,
      expected_parameters: [column("declared", "DOC", 2)],
      visits: [
        {
          id: "synced",
          collected_at: "2025-06-01T08:00:00Z",
          created_by: null,
          source: "portal_sync",
          notes: null,
          parameters_filled: 1,
          findings_open: 0,
          recompute: "current",
          cells: [cell("declared")],
        },
        {
          id: "entered",
          collected_at: "2025-06-02T08:00:00Z",
          created_by: "tester",
          source: "manual",
          notes: null,
          parameters_filled: 1,
          findings_open: 0,
          recompute: "current",
          cells: [cell("declared")],
        },
      ],
    });

    render(SiteVisitsTab, props({ declared: 2 }));

    // A visit whose outputs no calculation will write does not read like one that just recomputed.
    expect(await screen.findByText("not calculated here")).toBeTruthy();
    expect(screen.getAllByText("not calculated here")).toHaveLength(1);
  });
});
