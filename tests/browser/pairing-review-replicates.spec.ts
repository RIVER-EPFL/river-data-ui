import { expect, test, type APIRequestContext } from "@playwright/test";
import { API_URL, BASE_PATH, signIn, token } from "./portal";

// Scenario: a replicate family of five long source columns, unfolded on the pairing review's
// Sites tab. Expected behaviour: the stream's recent values read as a table with a header row
// naming each replicate and the statistics, and nothing in it scrolls sideways.

const COLUMNS = [1, 2, 3, 4, 5].map(
  (i) => `d13C_DIC_permil_vpdb_replicate_${i}`,
);

async function seedPlan(
  request: APIRequestContext,
): Promise<{ planId: string }> {
  const stamp = `${Date.now()}`;
  const sourceSystem = `replicates_${stamp}`;
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const post = async (path: string, data: unknown) => {
    const response = await request.post(`${API_URL}/api${path}`, {
      headers,
      data,
    });
    expect(
      response.ok(),
      `${path} -> ${response.status()} ${await response.text()}`,
    ).toBeTruthy();
    return response.json();
  };
  await post("/streams/register", {
    source_system: sourceSystem,
    source_key: `${sourceSystem}:grab_params:d13C_DIC`,
    measurement_type: "spot",
    metadata: {
      hierarchy: {
        project: `Replicates ${stamp}`,
        site: `Replicate Gauging Station ${stamp}`,
        parameter: "d13C_DIC",
      },
      units: "permil",
      replicates: {
        source_columns: COLUMNS,
        portal_mean_column: "d13C_DIC_avg",
      },
    },
  });
  const plan = await post("/sync/pairing-plans", {
    source_system: sourceSystem,
  });
  return { planId: plan.id };
}

test("the replicate fold-out is a headed table that does not scroll sideways", async ({
  page,
  request,
}) => {
  const { planId } = await seedPlan(request);
  // An unpaired stream holds no readings a fixture can reach through the API, so the preview
  // answers with three instants of the family.
  await page.route("**/streams/*/preview*", async (route) => {
    const streamId = route.request().url().split("/streams/")[1].split("/")[0];
    const instants = [0, 1, 2].map((k) => ({
      time: `2025-11-0${4 + k}T12:50:00Z`,
      mean: -8.38123,
      sd: 0.1412,
      n: 5,
      // The middle instant stores no fourth replicate, so its row keeps a gap in that column.
      replicates: COLUMNS.flatMap((column, i) =>
        k === 1 && i === 3
          ? []
          : [
              {
                column,
                replicate_index: i,
                value: -8.47511 + i * 0.05,
                is_flagged: i === 4,
                withdrawn: false,
              },
            ],
      ),
    }));
    await route.fulfill({
      json: {
        stream_id: streamId,
        source_key: "d13C_DIC",
        instants,
      },
    });
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

  await page.getByRole("button", { name: /^Sites / }).click();
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await page
    .getByRole("button", { name: /5 replicates/ })
    .first()
    .click();
  const table = page.locator("table table", {
    has: page.getByRole("columnheader", { name: "Instant" }),
  });
  await expect(table).toBeVisible();

  const headers = await table.getByRole("columnheader").allInnerTexts();
  expect(headers.map((h) => h.replace(/\s+/g, ""))).toEqual([
    "Instant",
    ...COLUMNS,
    "x̄",
    "s",
    "n",
  ]);
  await expect(table.locator("tbody tr")).toHaveCount(3);
  for (const row of await table.locator("tbody tr").all()) {
    await expect(row.locator("td")).toHaveCount(COLUMNS.length + 4);
  }
  await expect(
    table.locator("tbody tr").nth(1).locator("td").nth(4),
  ).toHaveText("--");

  const scrolls = await table.evaluate((t) => {
    let el: HTMLElement | null = t as HTMLElement;
    const offenders: string[] = [];
    for (; el && el.tagName !== "MAIN"; el = el.parentElement) {
      if (el.scrollWidth - el.clientWidth > 1)
        offenders.push(`${el.tagName}.${el.className}`);
    }
    return offenders;
  });
  expect(scrolls, "no box around the fold-out is wider than it shows").toEqual(
    [],
  );
});
