import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { API_URL, BASE_PATH, signIn, token } from "./portal";

// Scenario: the pairing review's Instruments tab, on a source whose serials, models and parameter
// names are as long as a real one's. Expected behaviour: nothing on the tab scrolls sideways in a
// 1400px window. A horizontal scrollbar is for a table wider than the viewport, never for one
// merely wider than the box it was put in.

/** A Vaisala logger serial is an unbroken token with no wrap opportunity of its own. */
const SERIAL = "AA0123456789BB0123456789CC0123456789DD01";
const MODEL =
  "Vaisala AQT530 Multiparameter Sonde with Integrated Barometric Compensation";
const SITE = "Les Dailles Upstream Gauging Station (right bank)";
const DEVICE_PARAMETERS = [
  "Dissolved oxygen concentration, optical",
  "Water temperature at the logger intake",
  "Logger battery terminal voltage",
];
const LAB_PARAMETERS = [
  "Dissolved organic carbon, acidified and sparged",
  "Chromophoric dissolved organic matter absorbance at 254 nm",
];

/**
 * A draft plan over one source system: three channels of one multi-channel logger, which the
 * review lists as devices, and two analytes with no instrument, which it lists as lab decisions.
 * Both of the tab's tables therefore have rows.
 */
async function seedPlan(
  request: APIRequestContext,
): Promise<{ planId: string }> {
  const stamp = `${Date.now()}`;
  const sourceSystem = `scroll_${stamp}`;
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

  // The hierarchy is declared on the stream, so the draft resolves every feed to a site and a
  // parameter and gives each entry the `pair` action the review's tables are built from.
  const register = (parameter: string, device: boolean) =>
    post("/streams/register", {
      source_system: sourceSystem,
      source_key: `${sourceSystem}:${device ? "sensor_params" : "grab_params"}:${parameter}`,
      metadata: {
        hierarchy: { project: `Scroll ${stamp}`, site: SITE, parameter },
        units: "mg/L",
        ...(device
          ? { device: { logger_serial: SERIAL, logger_device: MODEL } }
          : {}),
      },
    });

  for (const parameter of DEVICE_PARAMETERS) await register(parameter, true);
  for (const parameter of LAB_PARAMETERS) await register(parameter, false);

  // The source's own instrument register, whose keys are as long as a portal's really are.
  await post("/sensors/proposals", {
    source_system: sourceSystem,
    instruments: [
      {
        source_key: `${sourceSystem}:instrument:shimadzu_toc_l_cph_total_organic_carbon_analyser`,
        name: "Shimadzu TOC-L CPH total organic carbon analyser",
        serial_number: SERIAL,
        model: MODEL,
        is_lab_instrument: true,
        metadata: {
          installed_at: SITE,
          commissioned: "2019-04-02",
          firmware: "3.11.2",
        },
      },
    ],
  });

  const plan = await post("/sync/pairing-plans", {
    source_system: sourceSystem,
  });
  return { planId: plan.id };
}

/** Every element scrolling sideways, named by what a reader would recognise it as. */
async function sideScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter((el) => {
        if (el.scrollWidth - el.clientWidth <= 1) return false;
        const overflow = getComputedStyle(el).overflowX;
        return overflow === "auto" || overflow === "scroll";
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120)),
  );
}

/** Every table whose content is wider than the box it is in, named by its header row. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("main table"))
      .filter((t) => {
        const box = t.parentElement;
        return !!box && box.scrollWidth - box.clientWidth > 1;
      })
      .map((t) =>
        Array.from(t.querySelectorAll("th"))
          .map((h) => (h as HTMLElement).innerText)
          .join(" | "),
      ),
  );
}

test("the pairing review lists devices and lab instruments without scrolling sideways", async ({
  page,
  request,
}) => {
  const { planId } = await seedPlan(request);
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page);
  await page.goto(`${BASE_PATH}/streams?step=review&plan=${planId}`);

  await page.getByRole("button", { name: /^Instruments \(/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Devices the source identifies by serial",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Lab instruments" }),
  ).toBeVisible();
  await expect(
    page.getByText("From the source's instrument register"),
  ).toBeVisible();
  await expect(page.getByText(SERIAL).first()).toBeVisible();

  expect(
    await sideScrollers(page),
    "the Instruments tab adds no sideways scroller",
  ).toEqual([]);
  // Nor is anything hidden instead of scrolled: every table on the tab lays out inside its own
  // box, so the long tokens are read rather than clipped.
  expect(
    await overflowing(page),
    "every table on the tab fits the box it is in",
  ).toEqual([]);
});
