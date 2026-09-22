import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMeteoswissStations = vi.fn();
vi.mock("$api/service", () => ({
  getMeteoswissStations: (q: unknown) => getMeteoswissStations(q),
}));

const list = vi.fn();
const streams = vi.fn();
const jobs = vi.fn();
vi.mock("$api/crud", () => ({
  api: {
    meteoswissSubscriptions: {
      list: (opts: unknown) => list(opts),
      create: vi.fn(),
      remove: vi.fn(),
    },
    dataStreams: { list: (opts: unknown) => streams(opts) },
    reprocessingJobs: { list: (opts: unknown) => jobs(opts) },
  },
}));

const MeteoswissSubscriptions = (await import("./MeteoswissSubscriptions.svelte"))
  .default;

beforeEach(() => {
  streams.mockResolvedValue({ data: [] });
  jobs.mockResolvedValue({ data: [] });
});

const subscribed = {
  id: "sub-1",
  site_id: "site-1",
  station_abbr: "MOB",
  variable: "prestas0",
  parameter_id: "p-1",
  enabled: true,
};

const station = (
  abbr: string,
  name: string,
  distance: number | null,
  barometer: number | null,
  height: number | null,
) => ({
  station_abbr: abbr,
  name,
  distance_km: distance,
  height_barometer_masl: barometer,
  height_masl: height,
});

describe("MeteoswissSubscriptions", () => {
  it("shows each candidate's elevation and distance", async () => {
    list.mockResolvedValue({ data: [] });
    getMeteoswissStations.mockResolvedValue([
      station("MOB", "Montagnier, Bagnes", 18.3138, 840, 839),
    ]);

    render(MeteoswissSubscriptions, { siteId: "site-1" });

    await waitFor(() =>
      expect(screen.getByText(/Montagnier, Bagnes/)).toBeTruthy(),
    );
    expect(screen.getByText(/840 m · 18.3 km/)).toBeTruthy();
  });

  it("falls back to the station height where no barometer height is published", async () => {
    list.mockResolvedValue({ data: [] });
    getMeteoswissStations.mockResolvedValue([
      station("AEG", "Oberägeri", null, null, 724),
    ]);

    render(MeteoswissSubscriptions, { siteId: "site-1" });

    // A site with no coordinates ranks nothing, which is a dash rather than an empty list.
    await waitFor(() => expect(screen.getByText(/724 m · -/)).toBeTruthy());
  });

  it("names the station a site already subscribes to", async () => {
    list.mockResolvedValue({ data: [subscribed] });
    getMeteoswissStations.mockResolvedValue([]);

    render(MeteoswissSubscriptions, { siteId: "site-1" });

    // The variable picker offers the same label, so the attached row is read off the list entry.
    await waitFor(() => expect(screen.getByText("MOB")).toBeTruthy());
    expect(screen.getByText("· Barometric pressure")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
    expect(screen.queryByText(/No station\./)).toBeNull();
  });

  it("says when a subscription's stream has taken a value, and when it has not", async () => {
    list.mockResolvedValue({ data: [subscribed] });
    getMeteoswissStations.mockResolvedValue([]);
    streams.mockResolvedValue({
      data: [
        {
          source_key: "MOB:prestas0:site-1",
          last_data_time: "2026-09-22T08:40:00Z",
        },
      ],
    });

    render(MeteoswissSubscriptions, { siteId: "site-1" });
    await waitFor(() => expect(screen.getByText(/last value/)).toBeTruthy());
    expect(screen.queryByText(/no data yet/)).toBeNull();
  });

  it("says no data yet for a subscription whose stream has taken nothing", async () => {
    list.mockResolvedValue({ data: [subscribed] });
    getMeteoswissStations.mockResolvedValue([]);
    streams.mockResolvedValue({
      data: [{ source_key: "MOB:prestas0:site-1", last_data_time: null }],
    });

    render(MeteoswissSubscriptions, { siteId: "site-1" });
    await waitFor(() => expect(screen.getByText(/no data yet/)).toBeTruthy());
  });

  it("carries a failed backfill's reason in place of the data state", async () => {
    list.mockResolvedValue({ data: [subscribed] });
    getMeteoswissStations.mockResolvedValue([]);
    streams.mockResolvedValue({ data: [] });
    jobs.mockResolvedValue({
      data: [
        {
          trigger_type: "meteoswiss_backfill",
          status: "failed",
          error_message: "MOB publishes no prestas0 in 3 archives",
          created_at: "2026-09-22T08:07:00Z",
          params: { station: "MOB", variable: "prestas0" },
        },
      ],
    });

    render(MeteoswissSubscriptions, { siteId: "site-1" });
    await waitFor(() =>
      expect(screen.getByText(/publishes no prestas0/)).toBeTruthy(),
    );
  });

  it("greys a station that publishes nothing for the chosen variable", async () => {
    list.mockResolvedValue({ data: [] });
    getMeteoswissStations.mockResolvedValue([
      { ...station("MAR", "Martigny", 5.2, null, 990), publishes: false },
    ]);

    render(MeteoswissSubscriptions, { siteId: "site-1" });
    await waitFor(() => expect(screen.getByText(/Martigny/)).toBeTruthy());
    expect(screen.getByText(/no barometric pressure/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
