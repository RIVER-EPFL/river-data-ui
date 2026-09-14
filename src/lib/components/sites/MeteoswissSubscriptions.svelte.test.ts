import { render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

const getMeteoswissStations = vi.fn();
vi.mock("$api/service", () => ({
  getMeteoswissStations: (q: unknown) => getMeteoswissStations(q),
}));

const list = vi.fn();
vi.mock("$api/crud", () => ({
  api: {
    meteoswissSubscriptions: {
      list: (opts: unknown) => list(opts),
      create: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

const MeteoswissSubscriptions = (await import("./MeteoswissSubscriptions.svelte"))
  .default;

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
    list.mockResolvedValue({
      data: [
        {
          id: "sub-1",
          site_id: "site-1",
          station_abbr: "MOB",
          variable: "prestas0",
          parameter_id: "p-1",
          enabled: true,
        },
      ],
    });
    getMeteoswissStations.mockResolvedValue([]);

    render(MeteoswissSubscriptions, { siteId: "site-1" });

    // The variable picker offers the same label, so the attached row is read off the list entry.
    await waitFor(() => expect(screen.getByText("MOB")).toBeTruthy());
    expect(screen.getByText("· Barometric pressure")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
    expect(screen.queryByText(/No station\./)).toBeNull();
  });
});
