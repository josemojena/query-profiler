import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { Profile } from "../src/core/index.js";
import { toolbarScript } from "../src/ui/snippet.js";
import { DATA_REQUEST, NEXT_PAGE, PROFILE, PROMOTIONS, listItem } from "./fixture.js";
import { openStreams, setVisibility, trackStreams } from "./visibility.js";

const ORIGIN = "http://app.test";
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

interface Options {
  profiles?: Profile[];
  live?: Profile;
  api?: boolean;
  /** Script the page runs once the bar is there. */
  script?: string;
  /** The page as the Vite plugin serves it: the token in Server-Timing, the bar from a module. */
  timing?: { script: string };
}

/** A page of the app with the bar, the profiler API answering with these profiles, and what the app's own calls carried. */
async function open(page: Page, options: Options = {}) {
  const profiles = [...(options.profiles ?? [PROFILE]), ...(options.live ? [options.live] : [])];
  const parents: (string | null)[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body), headers });
    if (url.pathname === "/orders" && options.timing)
      return route.fulfill({
        contentType: "text/html",
        headers: { "Server-Timing": `query-profiler;desc="${PROFILE.token}"` },
        body: `<!doctype html><html><body><h1>Orders</h1><script type="module">${toolbarScript("/_profiler")}</script><script type="module">${options.timing.script}</script></body></html>`,
      });
    if (url.pathname === "/_profiler/ui.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/orders")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body><h1>Orders</h1><query-profiler-toolbar data-base="/_profiler" data-token="${PROFILE.token}"></query-profiler-toolbar><script type="module">${bundle}</script><script>window.popstates=0;addEventListener("popstate",()=>window.popstates++);${options.script ?? ""}</script></body></html>`,
      });
    if (url.pathname.startsWith("/api/") || url.pathname.endsWith(".data")) {
      parents.push(route.request().headers()["x-debug-parent"] ?? null);
      const token = url.pathname === "/api/promotions" ? PROMOTIONS.token : NEXT_PAGE.token;
      return json({}, { "X-Debug-Token": token });
    }
    if (options.api === false) return route.fulfill({ status: 404, body: "Not found" });
    if (url.pathname === "/_profiler/api/meta") return json({ root: "/repo" });
    if (url.pathname === "/_profiler/api/profiles") {
      const parent = url.searchParams.get("parent");
      return json(profiles.filter((p) => !parent || p.parentToken === parent).map(listItem));
    }
    if (url.pathname === "/_profiler/api/stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: options.live
          ? `event: profile\ndata: ${JSON.stringify(listItem(options.live))}\n\n`
          : ": connected\n\n",
      });
    const profile = profiles.find((p) => p.token === url.pathname.split("/").pop());
    return profile ? json(profile) : route.fulfill({ status: 404, body: "{}" });
  });
  await page.goto(`${ORIGIN}/orders`);
  return { parents, profiles };
}

const bar = (page: Page) => page.locator("query-profiler-toolbar");
const openPanel = (page: Page) => bar(page).locator(".summary").click();

test("sums up the page's request in a strip at the bottom", async ({ page }) => {
  await open(page);
  const strip = bar(page).locator(".strip");
  await expect(strip).toContainText("GET 200");
  await expect(strip).toContainText("/orders");
  await expect(strip).toContainText("7 queries");
  await expect(strip).toContainText("48.7 ms in DB");
  await expect(strip).toContainText("2 warnings");
  const box = await strip.boundingBox();
  expect(box!.y + box!.height).toBe(800);
  await expect(bar(page).locator(".panel")).toHaveCount(0);
});

test("opens on the page's requests; a request shows its queries, N+1 collapsed, slow marked", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const panel = bar(page).locator(".panel");
  await expect(panel.locator(".tab.on")).toHaveText("Requests (1)");
  await panel.locator("tr.main").click();
  await expect(panel.locator(".tab.on")).toHaveText("Queries (7)");
  await expect(panel.locator("tbody > tr")).toHaveCount(3);
  await expect(panel).toContainText("N+1 ×5");
  await expect(panel).toContainText("5 × 3.1 ms");
  await expect(panel.locator(".badge.slow")).toHaveText("slow");
  await expect(panel).toContainText("app/order-list.server.ts:31");
  await panel.getByText(`SELECT COUNT(*) FROM "Order"`).click();
  await expect(panel.getByRole("button", { name: "Copy runnable SQL" })).toBeVisible();
});

test("switches between its tabs", async ({ page }) => {
  await open(page);
  await openPanel(page);
  await bar(page).getByRole("button", { name: "Operations (6)" }).click();
  await expect(bar(page).locator(".panel")).toContainText("User.findUnique");
  await bar(page).getByRole("button", { name: "Timeline" }).click();
  await expect(bar(page).locator(".timeline")).toContainText("Order.findMany ×5");
  await bar(page).getByRole("button", { name: "Warnings (2)" }).click();
  await expect(bar(page).locator(".panel")).toContainText("likely an N+1");
  await bar(page).getByRole("button", { name: "Request", exact: true }).click();
  await expect(bar(page).locator("dl")).toContainText("a1b2c3");
});

test("shrinks to a pill and remembers it", async ({ page }) => {
  await open(page);
  await bar(page).getByRole("button", { name: "Minimize" }).click();
  await expect(bar(page).locator(".pill")).toContainText("7 queries");
  await expect(bar(page).locator(".strip")).toHaveCount(0);
  await page.reload();
  await expect(bar(page).locator(".pill")).toBeVisible();
  await bar(page).locator(".pill").click();
  await expect(bar(page).locator(".strip")).toBeVisible();
});

test("tags the page's calls with its token and shows them under it", async ({ page }) => {
  const { parents } = await open(page, {
    live: PROMOTIONS,
    script: `setTimeout(() => fetch("/api/promotions"), 300);`,
  });
  await expect(bar(page).locator(".strip")).toContainText("1 call");
  await expect(bar(page).locator(".strip")).toContainText("8 queries");
  await expect.poll(() => parents).toEqual([PROFILE.token]);
  await openPanel(page);
  await expect(bar(page).locator("tr.child")).toContainText("/api/promotions");
  await bar(page).locator("tr.child").click();
  await expect(bar(page).locator(".tab.on")).toHaveText("Queries (1)");
});

test("reads the page's token from Server-Timing, and tags the calls made before the bar is there", async ({
  page,
}) => {
  const { parents } = await open(page, {
    live: PROMOTIONS,
    timing: { script: `fetch("/api/promotions")` },
  });
  await expect.poll(() => parents).toEqual([PROFILE.token]);
  await expect(bar(page).locator(".strip")).toContainText("1 call");
  await expect(bar(page).locator(".strip")).toContainText("GET 200");
});

test("starts a new page when the app navigates, without faking a popstate", async ({ page }) => {
  await open(page, {
    profiles: [PROFILE, NEXT_PAGE],
    script: `setTimeout(async () => { await fetch("/orders/7.data"); history.pushState({}, "", "/orders/7"); }, 300);`,
  });
  await expect(bar(page).locator(".strip")).toContainText("/orders/7.data");
  expect(await page.evaluate(() => (window as unknown as { popstates: number }).popstates)).toBe(0);
});

test("starts a new page when the app navigates home, which React Router 8 loads from /_.data", async ({
  page,
}) => {
  await open(page, {
    profiles: [PROFILE, NEXT_PAGE],
    script: `setTimeout(async () => { await fetch("/_.data"); history.pushState({}, "", "/"); }, 300);`,
  });
  await expect(bar(page).locator(".strip")).toContainText("/orders/7.data");
});

test("lists recent requests and goes back to this page", async ({ page }) => {
  await open(page, { profiles: [PROFILE, DATA_REQUEST] });
  await bar(page)
    .getByRole("button", { name: /Recent/ })
    .click();
  await expect(bar(page).locator(".recent button")).toHaveCount(2);
  await bar(page).locator(".recent button", { hasText: "/orders.data" }).click();
  await expect(bar(page).locator(".strip")).toContainText("/orders.data");
  await bar(page).getByRole("button", { name: "Back to this page" }).click();
  await expect(bar(page).locator(".strip")).toContainText("7 queries");
});

test("gives its live connection back while the tab is hidden, and catches up when it shows again", async ({
  page,
}) => {
  await trackStreams(page);
  const { profiles } = await open(page);
  await expect(bar(page).locator(".strip")).toContainText("7 queries");
  await expect.poll(() => openStreams(page)).toBe(1);
  await setVisibility(page, "hidden");
  await expect.poll(() => openStreams(page)).toBe(0);
  profiles.push(PROMOTIONS);
  await setVisibility(page, "visible");
  await expect.poll(() => openStreams(page)).toBe(1);
  await expect(bar(page).locator(".strip")).toContainText("1 call");
});

test("opens no live connection in a tab that loads in the background", async ({ page }) => {
  await trackStreams(page);
  await page.addInitScript(() =>
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true }),
  );
  await open(page);
  await expect(bar(page).locator(".strip")).toContainText("7 queries");
  expect(await openStreams(page)).toBe(0);
});

test("shows nothing when the profiler API is not there", async ({ page }) => {
  await open(page, { api: false });
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(bar(page).locator(".strip")).toHaveCount(0);
});
