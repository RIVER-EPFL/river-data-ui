import { render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

const listRunnableJobs = vi.fn();
const runScheduleNow = vi.fn();
vi.mock("$api/service", () => ({
  listRunnableJobs: () => listRunnableJobs(),
  runScheduleNow: (name: string, inputs: unknown) => runScheduleNow(name, inputs),
  getUnpairedSummary: () => Promise.resolve([]),
}));

vi.mock("$api/crud", () => ({
  api: { sensors: { list: () => Promise.resolve({ data: [] }) } },
}));

const RunJobPanel = (await import("./RunJobPanel.svelte")).default;

const noParams = (name: string, interval: number | null) => ({
  job_name: name,
  manual_run: { offer: "no_parameters" },
  interval_seconds: interval,
  enabled: interval == null ? null : true,
});

const declared = (name: string, params: unknown[]) => ({
  job_name: name,
  manual_run: { offer: "declared", params },
  interval_seconds: null,
  enabled: null,
});

const spec = (name: string, kind: string, required: boolean, label: string) => ({
  name,
  kind,
  required,
  label,
});

describe("RunJobPanel", () => {
  it("says which kinds run on a cadence and which are on demand", async () => {
    listRunnableJobs.mockResolvedValue([
      noParams("alarm_sweep", 60),
      noParams("reprocess_all", null),
    ]);

    render(RunJobPanel, { canRun: true });

    await waitFor(() => expect(screen.getByText("every 60s")).toBeTruthy());
    expect(screen.getByText("on demand")).toBeTruthy();
  });

  it("holds the run until a required input is given, naming it", async () => {
    listRunnableJobs.mockResolvedValue([
      declared("manual_reprocess", [spec("sensor_id", "uuid", true, "Instrument")]),
    ]);

    render(RunJobPanel, { canRun: true });

    await waitFor(() => expect(screen.getByText("Needs Instrument")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("counts only the inputs it has a control for", async () => {
    // A list-valued input has no control here, and every kind that declares one declares it
    // optional, so the run is still offered.
    listRunnableJobs.mockResolvedValue([
      declared("measurement_retag", [
        spec("target", "text", true, "Measurement type"),
        spec("sensor_ids", "uuid_list", false, "Instruments"),
        spec("stream_ids", "uuid_list", false, "Streams"),
      ]),
    ]);

    render(RunJobPanel, { canRun: true });

    await waitFor(() => expect(screen.getByText("Inputs (1)")).toBeTruthy());
  });

  it("offers nothing to a person who cannot run jobs", async () => {
    listRunnableJobs.mockResolvedValue([noParams("alarm_sweep", 60)]);

    render(RunJobPanel, { canRun: false });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Run" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
  });
});
