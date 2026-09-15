import { render, screen } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSiteVisits = vi.fn();
const runEventRecompute = vi.fn();
const pollJob = vi.fn();
vi.mock("$api/service", () => ({
  listSiteVisits: (siteId: string, range: unknown) =>
    listSiteVisits(siteId, range),
  getCollectionEventDetail: vi.fn(),
  recomputeCollectionEvent: vi.fn(),
  runEventAudit: vi.fn(),
  runEventRecompute: (req: unknown) => runEventRecompute(req),
  pollJob: (id: string) => pollJob(id),
}));

const level = { value: 3 };
vi.mock("$auth/me.svelte", () => ({
  me: {
    can: () => true,
    get level() {
      return level.value;
    },
    data: null,
  },
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
  has_provenance: false,
  replicates: [
    {
      replicate_index: 0,
      value: STORED,
      stream_id: `stream-${id}`,
      flagged: false,
      withdrawn: false,
      unverified: false,
    },
  ],
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

    // The declaration the lab made is what the grid shows, in the cell the lab types into.
    expect(await screen.findByDisplayValue("100.80")).toBeTruthy();
    // A slot nobody declared for is not rounded to a precision nobody chose.
    expect(screen.getByDisplayValue("100.8")).toBeTruthy();
    expect(screen.queryByDisplayValue("100.800003")).toBeNull();
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
  it("asks for every listed visit, not only the flagged ones, when computing a new calculation", async () => {
    // Every visit is current: a calculation authored today has raised no finding anywhere, so
    // the findings arm would select nothing.
    listSiteVisits.mockResolvedValue({
      site_id: "site-1",
      page: 1,
      page_size: 50,
      total: 1,
      expected_parameters: [column("declared", "DOC", 2)],
      visits: [
        {
          id: "entered",
          collected_at: "2025-06-01T08:00:00Z",
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
    runEventRecompute.mockResolvedValue({ job_id: null });

    render(SiteVisitsTab, props({ declared: 2 }));

    await userEvent.click(await screen.findByText("Compute at listed visits"));
    await userEvent.click(screen.getByText("Compute"));

    expect(runEventRecompute).toHaveBeenCalledWith({
      site_id: "site-1",
      only_findings: false,
    });
  });

  // Expected behaviour: an intern enters measurements and does not change stored ones (Q21), so
  // the table offers them a cell to read, not one to type in.
  it("offers an intern no input over a value the store already holds", async () => {
    level.value = 1;
    listSiteVisits.mockResolvedValue({
      site_id: "site-1",
      page: 1,
      page_size: 50,
      total: 1,
      expected_parameters: [column("declared", "DOC", 2)],
      visits: [
        {
          id: "visit-1",
          collected_at: "2025-06-01T08:00:00Z",
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
    expect(await screen.findByText("100.80")).toBeTruthy();
    expect(screen.queryByDisplayValue("100.80")).toBeNull();
    level.value = 3;
  });
});
