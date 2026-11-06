import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { Analysis } from "../src/analysis/analyze.js";
import type { RuleSum, SessionAnalysis, Shape } from "../src/analysis/session.js";
import type { Profile, Stats } from "../src/core/index.js";
import { PROFILE, listItem } from "./fixture.js";

const ORIGIN = "http://app.test";
const COUNT = `SELECT COUNT(*) FROM "public"."Post" WHERE "public"."Post"."authorId" = $1`;
const PAGE = `SELECT "public"."Post"."id" FROM "public"."Post" WHERE "public"."Post"."authorId" = $1 LIMIT $2`;
const database = { id: "postgres#1", provider: "postgres" as const };

const POSTS: Profile = {
  ...PROFILE,
  token: "c0ffee",
  request: { method: "GET", url: "/" },
  operations: [],
  warnings: [],
  queries: [
    { id: "q_1", sql: COUNT, params: [1], fingerprint: "a", startMs: 1, durationMs: 8.5, database },
    {
      id: "q_2",
      sql: PAGE,
      params: [1, 10],
      fingerprint: "b",
      startMs: 12,
      durationMs: 1.9,
      database,
    },
  ],
  summary: { queryCount: 2, dbTimeMs: 10.4, operationCount: 0, errorCount: 0 },
};

const STATS: Stats = { profiles: 4, slowest: [], repeated: [], models: [], routes: [] };

const shape = (
  fingerprint: string,
  sql: string,
  runs: number,
  totalMs: number,
  queryId: string,
): Shape => ({
  fingerprint,
  sql,
  runs,
  totalMs,
  routes: ["/"],
  example: { token: POSTS.token, queryId },
});
const BY_AUTHOR = shape("a", COUNT, 12, 80.1, "q_1");
const AUTHOR_PAGE = shape("b", PAGE, 2, 14.52, "q_2");

const rule = (n: number, severity: RuleSum["severity"], totalMs: number): RuleSum => ({
  rule: `rule-${n}`,
  severity,
  message: `Finding number ${n}.`,
  shapes: 1,
  runs: 2,
  totalMs,
  example: BY_AUTHOR.example,
});

const SESSION: SessionAnalysis = {
  requests: 4,
  shapes: 17,
  analyzed: 17,
  skipped: 0,
  failed: [],
  databases: [{ engine: "postgres", version: "18.6" }],
  indexes: [
    {
      table: "Post",
      columns: ["authorId"],
      name: "Post_authorId_idx",
      prisma: "@@index([authorId])",
      sql: 'CREATE INDEX "Post_authorId_idx" ON "public"."Post" ("authorId");',
      shapes: [BY_AUTHOR, AUTHOR_PAGE],
      runs: 14,
      totalMs: 94.62,
      routes: ["/", "/problems"],
      covers: [],
    },
    {
      table: "Post",
      columns: ["views"],
      name: "Post_views_idx",
      prisma: "@@index([views])",
      sql: 'CREATE INDEX "Post_views_idx" ON "public"."Post" ("views");',
      shapes: [shape("c", `SELECT 1 FROM "public"."Post" ORDER BY "views"`, 2, 5.28, "q_2")],
      runs: 2,
      totalMs: 5.28,
      routes: ["/problems"],
      covers: [],
    },
  ],
  rules: [
    rule(1, "problem", 105.06),
    rule(2, "problem", 0.9),
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => rule(n, "warning", 20 - n)),
    rule(11, "info", 3),
    rule(12, "info", 1),
  ],
  tables: [
    { table: "Post", shapes: 11, runs: 32, totalMs: 140.01, fullReads: 7 },
    { table: "Product", shapes: 1, runs: 1, totalMs: 1.1, fullReads: 0 },
  ],
  notes: [
    {
      rule: "foreign-key-without-index",
      severity: "warning",
      about: "table",
      table: "Post",
      message:
        "Post.authorId references User with no index: PostgreSQL does not create one, so a join on it, or a delete in User, reads all of Post.",
      docs: "https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK",
    },
  ],
};

const ANALYSIS: Analysis = {
  engine: "postgres",
  version: "18.6",
  tables: [],
  findings: [],
  plan: {
    engine: "postgres",
    version: "18.6",
    measured: false,
    generic: false,
    approximate: false,
    raw: "[]",
    steps: [{ label: "Seq Scan", kind: "read", relation: "Post", access: "full", children: [] }],
  },
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

/** The profiler's Stats page, with the session's analysis answering `session`. */
async function open(
  page: Page,
  session: { status: number; body: unknown } = { status: 200, body: SESSION },
) {
  const asked: { path: string; header: string | undefined }[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/_profiler/ui.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/_profiler/api/meta") return json({ root: "/repo" });
    if (url.pathname === "/_profiler/api/profiles")
      return request.method() === "DELETE" ? json({ cleared: true }) : json([listItem(POSTS)]);
    if (url.pathname === "/_profiler/api/stream")
      return route.fulfill({ contentType: "text/event-stream", body: ": ok\n\n" });
    if (url.pathname === "/_profiler/api/stats/analysis" || url.pathname.includes("/queries/"))
      asked.push({ path: url.pathname, header: request.headers()["x-query-profiler"] });
    if (url.pathname === "/_profiler/api/stats/analysis") return json(session.body, session.status);
    if (url.pathname === "/_profiler/api/stats") return json(STATS);
    if (url.pathname.endsWith("/findings")) return json({});
    if (url.pathname.endsWith("/analysis")) return json(ANALYSIS);
    if (url.pathname === `/_profiler/api/profiles/${POSTS.token}`) return json(POSTS);
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><query-profiler-page data-base="/_profiler"></query-profiler-page><script type="module" src="/_profiler/ui.js"></script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/_profiler/stats`);
  return { app: page.locator("query-profiler-page"), asked };
}

test("asks the database nothing until the session is analyzed, then ranks the indexes by the time they fix", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  const session = app.locator(".session");
  await expect(session.locator(".lead")).toContainText(
    "Asks your database for the plan of every distinct statement in the last 4 requests",
  );
  expect(asked).toEqual([]);
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  await expect(session.locator(".lead").first()).toContainText(
    "17 distinct statements in 4 requests, each planned by PostgreSQL 18.6 once, through its slowest run.",
  );
  expect(asked).toEqual([{ path: "/_profiler/api/stats/analysis", header: "1" }]);
  const first = session.locator("table").first().locator("tbody tr").first();
  await expect(first).toContainText("@@index([authorId])");
  await expect(first).toContainText("on Post");
  await expect(first).toContainText("2 queries");
  await expect(first).toContainText("94.6 ms");
  await expect(first).toContainText("/ · /problems");
  await expect(app.getByRole("button", { name: "Analyze again ›" })).toBeVisible();
  await expect(session).toContainText("About the tables, whatever the query");
  await expect(session.getByRole("link", { name: "PostgreSQL manual" })).toHaveAttribute(
    "href",
    /ddl-constraints/,
  );
});

test("shows every problem and the six warnings with the most time, and folds the rest", async ({
  page,
}) => {
  const { app } = await open(page);
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  const findings = app.locator(".session table").nth(1).locator("tbody tr");
  await expect(findings).toHaveCount(8);
  await expect(findings.first()).toContainText("Finding number 1.");
  await expect(findings.last()).toContainText("Finding number 8.");
  const fold = app.locator(".session .fold");
  await expect(fold).toContainText("2 more warnings and 2 info findings");
  await fold.getByRole("button", { name: "Show" }).click();
  await expect(findings).toHaveCount(12);
  await expect(fold.getByRole("button", { name: "Hide" })).toBeVisible();
});

test("lists the queries an index would fix, and its SQL", async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  await app.getByRole("button", { name: "Show the 2 queries" }).click();
  await expect(app.locator(".shape")).toHaveCount(2);
  await expect(app.locator(".shape").first()).toContainText("12 runs · 80.1 ms");
  await app.getByRole("button", { name: "Show SQL" }).first().click();
  await expect(app.locator(".session .line").first()).toContainText(
    'CREATE INDEX "Post_authorId_idx"',
  );
  await expect(app.getByRole("link", { name: "Open the query ›" })).toHaveAttribute(
    "href",
    `/_profiler/${POSTS.token}#q_2`,
  );
});

test("opens a finding's query in its request, on Explain plan", async ({ page }) => {
  const { app, asked } = await open(page);
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  await app.locator(".session table").nth(1).getByRole("link", { name: "Open" }).first().click();
  await expect(page).toHaveURL(`${ORIGIN}/_profiler/${POSTS.token}#q_1`);
  const tools = app.locator("tr.tools");
  await expect(tools).toHaveCount(1);
  await expect(tools.locator(".qtab.on")).toContainText("Explain plan");
  await expect(tools.locator(".step")).toContainText("Reads every row");
  expect(asked.at(-1)).toEqual({
    path: `/_profiler/api/profiles/${POSTS.token}/queries/q_1/analysis`,
    header: "1",
  });
});

test("says what went wrong when the session could not be analyzed", async ({ page }) => {
  const { app } = await open(page, {
    status: 422,
    body: { error: "database_error", message: "connection refused" },
  });
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  await expect(app.locator(".session .lead")).toHaveText(
    "Couldn't analyze the session: connection refused",
  );
});

test("forgets the analysis when the stored requests are cleared", async ({ page }) => {
  const { app } = await open(page);
  await app.getByRole("button", { name: "Analyze the session ›" }).click();
  await expect(app.getByRole("button", { name: "Analyze again ›" })).toBeVisible();
  await app.getByRole("button", { name: "Clear" }).click();
  await expect(app.getByRole("button", { name: "Analyze the session ›" })).toBeVisible();
  await expect(app.locator(".session table")).toHaveCount(0);
});
