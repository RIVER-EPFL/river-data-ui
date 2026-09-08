import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurationDrift = vi.fn();
const listUndeclaredSdEstimators = vi.fn();
vi.mock("$api/service", () => ({
  getCurationDrift: (limit?: number) => getCurationDrift(limit),
  listUndeclaredSdEstimators: () => listUndeclaredSdEstimators(),
}));

const InvariantReportsPanel = (await import("./InvariantReportsPanel.svelte"))
  .default;

const clean = () => {
  getCurationDrift.mockResolvedValue({ total: 0, rows: [] });
  listUndeclaredSdEstimators.mockResolvedValue({
    total_slots: 0,
    total_undeclared_samples: 0,
    total_population_signature_holds: 0,
    slots: [],
  });
};

beforeEach(() => vi.clearAllMocks());

describe("InvariantReportsPanel", () => {
  it("states a clean result rather than showing an empty table", async () => {
    clean();
    render(InvariantReportsPanel, {});
    const heading = await screen.findByText(
      /Readings that disagree with their decision record/,
    );
    await fireEvent.click(heading.closest("button")!);
    expect(
      screen.getByText(
        /Every reading's curation columns are the fold of the decisions/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("links a drifted reading to the point it belongs to", async () => {
    getCurationDrift.mockResolvedValue({
      total: 1,
      rows: [
        {
          stream_id: "stream-1",
          time: "2025-06-01T08:00:00Z",
          replicate_index: 0,
          site_id: "site-1",
          parameter_id: "param-1",
          stored: { is_flagged: false },
          folded: { is_flagged: true },
        },
      ],
    });
    listUndeclaredSdEstimators.mockResolvedValue({
      total_slots: 0,
      total_undeclared_samples: 0,
      total_population_signature_holds: 0,
      slots: [],
    });
    render(InvariantReportsPanel, {});
    const heading = await screen.findByText(
      /Readings that disagree with their decision record/,
    );
    await fireEvent.click(heading.closest("button")!);
    const link = screen.getByRole("link", { name: "Open the point" });
    expect(link.getAttribute("href")).toContain("/sites/site-1?focus=param-1");
  });

  it("reports both counts without asking the user to run anything", async () => {
    clean();
    render(InvariantReportsPanel, {});
    await screen.findByText(/Readings that disagree/);
    expect(getCurationDrift).toHaveBeenCalled();
    expect(listUndeclaredSdEstimators).toHaveBeenCalled();
  });
});
