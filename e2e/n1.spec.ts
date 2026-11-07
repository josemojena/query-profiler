import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { N1Fix } from "../src/analysis/n1.js";
import type { Profile, QueryRecord } from "../src/core/index.js";
import { PROFILE, listItem } from "./fixture.js";

const ORIGIN = "http://app.test";
const database = { id: "postgres#1", provider: "postgres" as const };
const HOME = { file: "/repo/app/routes/home.tsx", line: 6 };
const LOOP = { file: "/repo/app/routes/home.tsx", line: 8 };

const counts: QueryRecord[] = [1, 2, 3, 4, 5, 6].map((id) => ({
  id: `q_${id + 1}`,
  opId: `op_${id + 1}`,
  sql: `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Post"."id" FROM "public"."Post" WHERE "public"."Post"."authorId" = $1 OFFSET $2) AS "sub"`,
  params: [id, "0"],
  fingerprint: "count",
  startMs: 5 + id,
  durationMs: 10.4,
  rows: 1,
  database,
}));

// The React Router example's home page: six users, then their posts counted one by one.
const HOME_PAGE: Profile = {
  ...PROFILE,
  token: "f00d00",
  request: { method: "GET", url: "/" },
  operations: [
    {
      id: "op_1",
      model: "User",
      action: "findMany",
      startMs: 1,
      durationMs: 12,
      origin: [HOME],
      queryIds: ["q_1"],
    },
    ...counts.map((query) => ({
      id: query.opId!,
      model: "Post",
      action: "count",
      startMs: query.startMs,
      durationMs: 10.6,
      origin: [LOOP],
      queryIds: [query.id],
    })),
  ],
  queries: [
    {
      id: "q_1",
      opId: "op_1",
      sql: `SELECT "public"."User"."id", "public"."User"."email" FROM "public"."User" ORDER BY "public"."User"."id" ASC LIMIT $1 OFFSET $2`,
      params: [6, "0"],
      fingerprint: "users",
      startMs: 1,
      durationMs: 11.8,
      rows: 6,
      database,
    },
    ...counts,
  ],
  warnings: [{ kind: "n+1", fingerprint: "count", queryIds: counts.map((query) => query.id) }],
  summary: { queryCount: 7, dbTimeMs: 23.4, operationCount: 7, errorCount: 0 },
};

const FIX: N1Fix = {
  operation: "Post.count",
  times: 6,
  origin: LOOP,
  varying: { path: "authorId", values: [1, 2, 3, 4, 5, 6], count: 6 },
  source: { operation: "User.findMany", origin: HOME, rows: 6 },
  relation: "Post.authorId points to User",
  options: [
    {
      title: "In the query before",
      short: "include",
      lines: [
        { text: "prisma.user.findMany({" },
        { text: '  orderBy: { id: "asc" },' },
        { text: "  take: 6," },
        { text: "  include: { _count: { select: { posts: true } } },", added: true },
        { text: "})" },
      ],
      queries: 1,
      instead: 7,
      note: "Each user comes with _count.posts; the loop of counts goes.",
    },
    {
      title: "One query for all of them",
      short: "groupBy",
      lines: [{ text: 'prisma.post.groupBy({ by: ["authorId"], _count: { _all: true } })' }],
      queries: 2,
      instead: 7,
    },
  ],
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

/** The profiler's page on the home page's request, the fixes route answering `fixes`. */
async function open(page: Page, fixes: Record<string, N1Fix> = { q_2: FIX }) {
  const asked: string[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/_profiler/ui.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/_profiler/api/meta") return json({ root: "/repo" });
    if (url.pathname === "/_profiler/api/profiles") return json([listItem(HOME_PAGE)]);
    if (url.pathname === "/_profiler/api/stream")
      return route.fulfill({ contentType: "text/event-stream", body: ": ok\n\n" });
    if (url.pathname.endsWith("/findings")) return json({});
    if (url.pathname.endsWith("/fixes")) {
      asked.push(url.pathname);
      return json(fixes);
    }
    if (url.pathname === `/_profiler/api/profiles/${HOME_PAGE.token}`) return json(HOME_PAGE);
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><query-profiler-page data-base="/_profiler"></query-profiler-page><script type="module" src="/_profiler/ui.js"></script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/_profiler/${HOME_PAGE.token}`);
  return { app: page.locator("query-profiler-page"), asked };
}

test("shows the rows of each query, of each run of an N+1, and of each operation", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await expect(app.locator("td.rows")).toHaveText(["6", "6 × 1"], { useInnerText: true });
  await app.getByRole("button", { name: /^Operations/ }).click();
  await expect(app.locator("td.rows").first()).toHaveText("6", { useInnerText: true });
  expect(asked).toEqual([]);
});

test("opens an N+1's fix from its row: what repeats, where its values came from, the code to copy", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await app.getByRole("button", { name: "Fix the N+1 ›" }).click();
  const tools = app.locator("tr.tools");
  await expect(tools.locator(".qtab.on")).toHaveText(/^Fix the N\+1\s*1 query instead of 7$/);
  await expect(tools.locator(".said").first()).toHaveText(
    "Post.count ran 6 times from app/routes/home.tsx:8, once for each authorId: 1, 2, 3, 4, 5, 6. They are the 6 rows User.findMany read just before, at app/routes/home.tsx:6: Post.authorId points to User in your schema.",
  );
  await expect(tools.locator(".h")).toHaveText([
    /^In the query before\s*1 query instead of 7$/,
    /^One query for all of them\s*2 queries instead of 7$/,
  ]);
  await expect(tools.locator(".fix-code").first().locator(".added")).toHaveText(
    "  include: { _count: { select: { posts: true } } },",
  );
  await expect(tools.getByRole("button", { name: "Copy", exact: true }).first()).toHaveAttribute(
    "data-copy",
    FIX.options[0]!.lines.map((line) => line.text).join("\n"),
  );
  await expect(tools.getByRole("button", { name: "Explain plan" })).toBeVisible();
  expect(asked).toEqual([`/_profiler/api/profiles/${HOME_PAGE.token}/fixes`]);
});

test("opens the fix from the Warnings tab, on the Queries tab", async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole("button", { name: /^Warnings/ }).click();
  await app.getByRole("button", { name: "Fix the N+1 ›" }).click();
  await expect(app.locator(".tab.on")).toHaveText("Queries (7)");
  await expect(app.locator("tr.tools .qtab.on")).toContainText("Fix the N+1");
  await expect(app.locator("tr.tools .fix-code")).toHaveCount(2);
});

test("says so when no single query replaces the loop", async ({ page }) => {
  const note = "Each update writes different values: no single query does that.";
  const { app } = await open(page, { q_2: { ...FIX, source: undefined, options: [], note } });
  await app.getByRole("button", { name: "Fix the N+1 ›" }).click();
  await expect(app.locator("tr.tools .said").nth(1)).toHaveText(note);
  await expect(app.locator("tr.tools .fix-code")).toHaveCount(0);
});
