import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getChangeProposals = vi.fn();
const decideChangeProposals = vi.fn();
vi.mock("$api/service", () => ({
  getChangeProposals: (params: unknown) => getChangeProposals(params),
  decideChangeProposals: (ids: string[], decision: string) =>
    decideChangeProposals(ids, decision),
}));

const ChangeProposalsPanel = (await import("./ChangeProposalsPanel.svelte"))
  .default;

const proposal = {
  id: "prop-1",
  stream_id: "stream-1",
  source_system: "cnet",
  source_key: "FP15:DOC_avg_ppb:reps",
  site_id: "site-1",
  site_name: "FP15",
  parameter_id: "param-1",
  parameter_code: "DOC",
  time: "2025-06-01T08:00:00Z",
  replicate_index: 0,
  stored_raw_value: 10,
  proposed_raw_value: 11.5,
  stored_standard_curve_id: null,
  proposed_standard_curve_id: null,
  status: "pending",
  first_seen_at: "2026-01-01T08:00:00Z",
  last_seen_at: "2026-01-02T08:00:00Z",
  decided_by: null,
  decided_at: null,
};

/** The generated list answers with rows and a total. */
const page = (rows: unknown[]) => ({ data: rows, total: rows.length });

beforeEach(() => vi.clearAllMocks());

describe("ChangeProposalsPanel", () => {
  it("shows the stored value beside the one the source now asserts", async () => {
    getChangeProposals.mockResolvedValue(page([proposal]));
    render(ChangeProposalsPanel, {});
    const row = (await screen.findByRole("cell", { name: /FP15/ })).closest(
      "tr",
    )!;
    expect(within(row).getByText("10")).toBeTruthy();
    expect(within(row).getByText("11.5")).toBeTruthy();
  });

  it("decides only the selected proposals", async () => {
    getChangeProposals.mockResolvedValue(page([proposal]));
    decideChangeProposals.mockResolvedValue({
      accepted: 1,
      rejected: 0,
      refused: [],
    });
    render(ChangeProposalsPanel, {});
    await screen.findByRole("cell", { name: /FP15/ });

    // Nothing selected is nothing decided: the buttons do not fire on an empty selection.
    await fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(decideChangeProposals).not.toHaveBeenCalled();

    await fireEvent.change(screen.getByRole("checkbox"));
    await fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(decideChangeProposals).toHaveBeenCalledWith(["prop-1"], "accept");
  });

  it("counts what is awaiting a decision for the tab that hosts it", async () => {
    getChangeProposals.mockResolvedValue(page([proposal, { ...proposal, id: "prop-2" }]));
    let counted = 0;
    render(ChangeProposalsPanel, {
      onPendingChange: (n: number) => (counted = n),
    });
    await screen.findAllByRole("cell", { name: /FP15/ });
    expect(counted).toBe(2);
  });

  it("asks the generated list for one status at a time", async () => {
    getChangeProposals.mockResolvedValue(page([proposal]));
    render(ChangeProposalsPanel, {});
    await screen.findByRole("cell", { name: /FP15/ });
    expect(getChangeProposals).toHaveBeenCalledWith({
      status: "pending",
      page: 1,
      perPage: 50,
    });
  });
});
