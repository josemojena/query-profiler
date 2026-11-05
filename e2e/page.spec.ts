import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { Profile } from "../src/core/index.js";
import { DATA_REQUEST, PROFILE, PROMOTIONS, listItem } from "./fixture.js";
import { openStreams, setVisibility, trackStreams } from "./visibility.js";

const ORIGIN = "http://app.test";
// Newest first, as the API lists them: the call, its page, then an older request.
const PROFILES: Profile[] = [PROMOTIONS, PROFILE, DATA_REQUEST];
const INVOICES: Profile = {
  ...DATA_REQUEST,
  token: "b0b0b0",
  kind: "document",
  request: { method: "GET", url: "/invoices" },
  startedAt: PROFILE.startedAt + 60_000,
};
let bundle = "";

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [new URL("../src/ui/index.ts", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    write: false,
  });
  bundle = result.outputFiles[0]!.text;
});

/** The profiler's page at `path`, with the API answering with `profiles`. */
async function open(page: Page, path: string, profiles = [...PROFILES]) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/_profiler/ui.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/_profiler/api/meta") return json({ root: "/repo" });
    if (url.pathname === "/_profiler/api/profiles") return json(profiles.map(listItem));
    if (url.pathname === "/_profiler/api/stream")
      return route.fulfill({ contentType: "text/event-stream", body: ": ok\n\n" });
    if (url.pathname === "/_profiler/api/stats")
      return json({
        profiles: 3,
        slowest: [
          {
            fingerprint: "e",
            sql: `SELECT COUNT(*) FROM "Order"`,
            count: 1,
            totalMs: 112.4,
            maxMs: 112.4,
            token: PROFILE.token,
          },
        ],
        repeated: [
          {
            fingerprint: "0",
            sql: `SELECT "id" FROM "Order"`,
            count: 5,
            totalMs: 15.5,
            maxMs: 3.1,
            token: PROFILE.token,
          },
        ],
        models: [{ model: "Order", operations: 5, totalMs: 17 }],
        routes: [{ path: "/orders", requests: 2, queries: 8, dbTimeMs: 49.9, warnings: 2 }],
      });
    const profile = profiles.find((p) => p.token === url.pathname.split("/").pop());
    if (url.pathname.startsWith("/_profiler/api/profiles/") && profile) return json(profile);
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><query-profiler-page data-base="/_profiler"></query-profiler-page><script type="module" src="/_profiler/ui.js"></script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}${path}`);
  return page.locator("query-profiler-page");
}

test("opens on the newest page, with its calls under it in the list", async ({ page }) => {
  const app = await open(page, "/_profiler");
  await expect(app.locator("h1")).toContainText("GET /orders");
  await expect(app.locator(".item.on")).toContainText("/orders");
  await expect(app.locator(".item.child")).toContainText("/api/promotions");
  await expect(app.locator(".card.warn")).toContainText("warnings: N+1, slow");
  await expect(app.locator(".tab.on")).toHaveText("Queries (7)");
  await expect(app).toContainText("N+1 ×5");
});

test("goes to a call through the address, and back to its page", async ({ page }) => {
  const app = await open(page, `/_profiler/${PROMOTIONS.token}`);
  await expect(app.locator("h1")).toContainText("GET /api/promotions");
  await app.getByRole("link", { name: "/orders" }).first().click();
  await expect(page).toHaveURL(`${ORIGIN}/_profiler/${PROFILE.token}`);
  await expect(app.locator("h1")).toContainText("GET /orders");
  await page.goBack();
  await expect(app.locator("h1")).toContainText("GET /api/promotions");
});

test("switches tabs and filters the list", async ({ page }) => {
  const app = await open(page, `/_profiler/${PROFILE.token}`);
  await app.getByRole("button", { name: "Timeline" }).click();
  await expect(app.locator(".timeline")).toContainText("Order.findMany ×5");
  await app.getByLabel("Filter requests").fill("promo");
  await expect(app.locator(".item")).toHaveCount(2);
  await expect(app.getByLabel("Filter requests")).toBeFocused();
});

test("shows the stats", async ({ page }) => {
  const app = await open(page, "/_profiler/stats");
  await expect(app.locator("h1")).toHaveText("Stats");
  await expect(app).toContainText("Slowest statements");
  await expect(app).toContainText(`SELECT COUNT(*) FROM "Order"`);
  await expect(app.locator(".switch a.on")).toHaveText("Stats");
  await app.getByRole("link", { name: "Requests" }).click();
  await expect(app.locator("h1")).toContainText("GET /orders");
});

test("gives its live connection back while the tab is hidden, and lists what finished meanwhile", async ({
  page,
}) => {
  await trackStreams(page);
  const profiles = [...PROFILES];
  const app = await open(page, "/_profiler", profiles);
  await expect(app.locator("h1")).toContainText("GET /orders");
  await expect.poll(() => openStreams(page)).toBe(1);
  await setVisibility(page, "hidden");
  await expect.poll(() => openStreams(page)).toBe(0);
  profiles.unshift(INVOICES);
  await setVisibility(page, "visible");
  await expect(app.locator(".item", { hasText: "/invoices" })).toBeVisible();
  await expect.poll(() => openStreams(page)).toBe(1);
});
