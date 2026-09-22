import { render, screen, within } from "@testing-library/svelte";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listSiteVisits = vi.fn();
const runEventRecompute = vi.fn();
const pollJob = vi.fn();
const getCollectionEventDetail = vi.fn();
vi.mock("$api/service", () => ({
  listSiteVisits: (siteId: string, range: unknown) =>
    listSiteVisits(siteId, range),
  getCollectionEventDetail: (id: string) => getCollectionEventDetail(id),
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
const { timezoneStore } = await import("$lib/stores/timezone.svelte");
const { formatCompactInstant, zoneLabel } = await import("$lib/utils");

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

beforeEach(() => {
  vi.clearAllMocks();
  timezoneStore.set("local");
});

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
    const declared = await screen.findByText("100.80");
    expect(declared.closest("td")?.classList.contains("htDimmed")).toBe(false);
    // A slot nobody declared for is not rounded to a precision nobody chose.
    expect(screen.getByText("100.8")).toBeTruthy();
    const grid = within(document.querySelector<HTMLElement>(".ht_master")!);
    // The browser's zone by default: the header names it and the cell prints its wall clock.
    const collected = "2025-06-01T08:00:00Z";
    expect(grid.getByText(`Date (${zoneLabel(undefined)})`)).toBeTruthy();
    expect(
      grid.getByRole("button", { name: formatCompactInstant(collected, undefined) }),
    ).toBeTruthy();
    expect(grid.queryByText("Source")).toBeNull();
    expect(grid.queryByText("Filled")).toBeNull();
    expect(screen.queryByText("100.800003")).toBeNull();
  });

  it("redraws the date column in the zone the header toggle names", async () => {
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
          id: "v1",
          collected_at: "2025-06-01T08:00:00Z",
          source: "manual",
          created_by: "tester",
          parameters_filled: 2,
          findings_open: 0,
          unverified: false,
          recompute: "current",
          cells: [cell("declared"), cell("undeclared")],
        },
      ],
    });

    render(SiteVisitsTab, props({ declared: 2, undeclared: null }));
    await screen.findByText("100.80");
    const grid = within(document.querySelector<HTMLElement>(".ht_master")!);

    timezoneStore.set("utc");
    expect(await grid.findByText("Date (UTC)")).toBeTruthy();
    expect(grid.getByRole("button", { name: "2025-06-01 08:00:00" })).toBeTruthy();

    timezoneStore.set("local");
    expect(await grid.findByText(`Date (${zoneLabel(undefined)})`)).toBeTruthy();
    expect(
      grid.getByRole("button", {
        name: formatCompactInstant("2025-06-01T08:00:00Z", undefined),
      }),
    ).toBeTruthy();
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
    await screen.findAllByText("not calculated here");
    const grid = within(document.querySelector<HTMLElement>(".ht_master")!);
    expect(grid.getAllByText("not calculated here")).toHaveLength(1);
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

  // Scenario: a visit holds a temperature that a calculation read and the pCO2 it wrote.
  //
  // Expected behaviour: selecting either cell lights the other by the reading the calculation
  // consumed, and the selected cell carries a control opening that one recording (M282, Q215).
  describe("tool-connected cells", () => {
    const consumed = () => ({
      id: "visit-1",
      site_id: "site-1",
      collected_at: "2025-06-01T08:00:00Z",
      cells: [
        {
          ...cell("temp"),
          parameter_code: "temp",
          parameter_name: "temp",
          origin: "manual",
          stream_id: "stream-temp",
          record: {
            origin: {
              stream_id: "stream-temp",
              source_system: "grab_sample",
              source_key: "temp",
              classification: "manual",
            },
            readings: [],
            chain: {},
            holds: [],
          },
        },
        {
          ...cell("pco2"),
          parameter_code: "pco2",
          parameter_name: "pco2",
          origin: "manual",
          stream_id: "stream-pco2",
          record: {
            origin: {
              stream_id: "stream-pco2",
              source_system: "derived",
              source_key: "pco2",
              classification: "derived",
            },
            readings: [],
            chain: {},
            holds: [],
            consumed: [
              {
                variable: "temp",
                kind: "reading",
                revision: null,
                current_revision: null,
                value: STORED,
                state: "unchanged",
                members: [
                  {
                    stream_id: "stream-temp",
                    time: "2025-06-01T08:00:00Z",
                    replicate_index: 0,
                    revision: null,
                    value: STORED,
                    current_revision: null,
                    current_value: STORED,
                    state: "unchanged",
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    function open() {
      listSiteVisits.mockResolvedValue({
        site_id: "site-1",
        page: 1,
        page_size: 50,
        total: 1,
        expected_parameters: [column("temp", "TEMP", 2), column("pco2", "PCO2", 2)],
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
            cells: [cell("temp"), cell("pco2")],
          },
        ],
      });
      getCollectionEventDetail.mockResolvedValue(consumed());
      return render(SiteVisitsTab, props({ temp: 2, pco2: 2 }));
    }

    /** The cell of one parameter, found by the label the renderer puts on it. */
    function cellOf(code: string): HTMLTableCellElement {
      const grid = document.querySelector<HTMLElement>(".ht_master")!;
      return grid.querySelector<HTMLTableCellElement>(
        `td[aria-label^="${code} at "]`,
      )!;
    }

    it("lights the reading a selected output consumed", async () => {
      const view = open();
      await screen.findAllByText("100.80");
      await userEvent.click(cellOf("PCO2"));
      await vi.waitFor(() =>
        expect(
          view.container.querySelectorAll("td.sheet-reads").length,
        ).toBeGreaterThan(0),
      );
      expect(cellOf("TEMP").classList.contains("sheet-reads")).toBe(true);
      expect(cellOf("PCO2").classList.contains("sheet-reads")).toBe(false);
    });

    it("lights the output that consumed a selected input", async () => {
      const view = open();
      await screen.findAllByText("100.80");
      await userEvent.click(cellOf("TEMP"));
      await vi.waitFor(() =>
        expect(
          view.container.querySelectorAll("td.sheet-read-by").length,
        ).toBeGreaterThan(0),
      );
      expect(cellOf("PCO2").classList.contains("sheet-read-by")).toBe(true);
    });

    it("gives the selected cell a control that opens that one recording", async () => {
      open();
      await screen.findAllByText("100.80");
      await userEvent.click(cellOf("PCO2"));
      const control = await screen.findByRole("button", {
        name: "Open the record of PCO2 at this visit",
      });
      expect(control.title).toContain("Alt+Enter");
      expect(control.closest("td")).toBe(cellOf("PCO2"));
    });

    it("lights nothing while the visit's detail cannot be read", async () => {
      listSiteVisits.mockResolvedValue({
        site_id: "site-1",
        page: 1,
        page_size: 50,
        total: 1,
        expected_parameters: [column("temp", "TEMP", 2), column("pco2", "PCO2", 2)],
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
            cells: [cell("temp"), cell("pco2")],
          },
        ],
      });
      getCollectionEventDetail.mockRejectedValue(new Error("no"));
      const view = render(SiteVisitsTab, props({ temp: 2, pco2: 2 }));
      await screen.findAllByText("100.80");
      await userEvent.click(cellOf("PCO2"));
      expect(view.container.querySelectorAll("td.sheet-reads")).toHaveLength(0);
      expect(view.container.querySelectorAll("td.sheet-read-by")).toHaveLength(0);
    });
  });

  // Expected behaviour: an intern enters measurements and does not change stored ones (Q21), so
  // the grid marks the cell read-only.
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
    const stored = await screen.findByText("100.80");
    expect(stored.closest("td")?.classList.contains("htDimmed")).toBe(true);
    level.value = 3;
  });
});
