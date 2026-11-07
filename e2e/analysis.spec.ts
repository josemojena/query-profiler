import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import type { Analysis, Finding, Trial } from "../src/analysis/analyze.js";
import type { PlanStep } from "../src/analysis/plan.js";
import type { Profile } from "../src/core/index.js";
import { PROFILE, listItem } from "./fixture.js";

const ORIGIN = "http://app.test";
const COUNT = `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Post"."id" FROM "public"."Post" WHERE "public"."Post"."authorId" = $1 OFFSET $2) AS "sub"`;
const SEARCH = `SELECT "public"."User"."id" FROM "public"."User" WHERE "public"."User"."name" ILIKE ('%' || $1 || '%') OFFSET $2`;
const database = { id: "postgres#1", provider: "postgres" as const };

const POSTS: Profile = {
  ...PROFILE,
  token: "c0ffee",
  request: { method: "GET", url: "/" },
  operations: [],
  warnings: [],
  queries: [
    {
      id: "q_1",
      sql: COUNT,
      params: [1, "0"],
      fingerprint: "a",
      startMs: 1,
      durationMs: 8.5,
      database,
    },
    {
      id: "q_2",
      sql: SEARCH,
      params: ["ann", "0"],
      fingerprint: "b",
      startMs: 12,
      durationMs: 1.9,
      database,
    },
  ],
  summary: { queryCount: 2, dbTimeMs: 10.4, operationCount: 0, errorCount: 0 },
};

const SEARCH_CLUE: Finding = {
  rule: "insensitive-match",
  severity: "warning",
  about: "query",
  message:
    'ILIKE on User.name, which Prisma sends for mode: "insensitive": a B-tree index serves it only when the pattern starts with a character that has no case, so every row is read.',
};

const ANALYSIS: Analysis = {
  engine: "postgres",
  version: "18.6",
  tables: [],
  plan: {
    engine: "postgres",
    version: "18.6",
    measured: false,
    generic: false,
    approximate: false,
    raw: '[{ "Plan": { "Node Type": "Aggregate" } }]',
    steps: [
      {
        label: "Aggregate",
        kind: "group",
        rows: 1,
        children: [
          {
            label: "Seq Scan",
            kind: "read",
            table: "Post",
            relation: "Post",
            access: "full",
            filter: '("authorId" = $1)',
            rows: 6,
            children: [],
          },
        ],
      },
    ],
  },
  findings: [
    {
      rule: "full-scan-small-table",
      severity: "info",
      about: "query",
      message:
        "Reads all 6 rows of Post: cheap at this size, but no index has authorId, so it will read every row as the table grows.",
      table: "Post",
      step: 1,
      fix: {
        kind: "index",
        text: "Add an index on authorId to the Post model, then run prisma migrate dev.",
        index: "Post_authorId_idx",
        prisma: "@@index([authorId])",
        sql: 'CREATE INDEX "Post_authorId_idx" ON "public"."Post" ("authorId");',
      },
    },
    {
      rule: "foreign-key-without-index",
      severity: "warning",
      about: "table",
      message:
        "Post.authorId references User with no index: PostgreSQL does not create one, so a join on it, or a delete in User, reads all of Post.",
      table: "Post",
      docs: "https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK",
    },
  ],
};

const TRIAL: Trial = {
  index: "Post_authorId_idx",
  used: true,
  before: 1.08,
  after: 0.14,
  plan: {
    ...ANALYSIS.plan!,
    steps: [
      {
        label: "Index Scan",
        kind: "read",
        table: "Post",
        access: "index",
        index: "Post_authorId_idx",
        lookup: '("authorId" = $1)',
        children: [],
      },
    ],
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

interface Asked {
  path: string;
  header: string | undefined;
  body: string | null;
}

/** The profiler's page on the request, with the analysis API answering `analysis`. */
async function open(
  page: Page,
  analysis: { status: number; body: unknown } = { status: 200, body: ANALYSIS },
) {
  const asked: Asked[] = [];
  await page.route(`${ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/_profiler/ui.js")
      return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/_profiler/api/meta") return json({ root: "/repo" });
    if (url.pathname === "/_profiler/api/profiles") return json([listItem(POSTS)]);
    if (url.pathname === "/_profiler/api/stream")
      return route.fulfill({ contentType: "text/event-stream", body: ": ok\n\n" });
    if (url.pathname.includes("/queries/") || url.pathname.endsWith("/findings"))
      asked.push({
        path: url.pathname + url.search,
        header: request.headers()["x-query-profiler"],
        body: request.postData(),
      });
    if (url.pathname === `/_profiler/api/profiles/${POSTS.token}/findings`)
      return json({ q_1: [], q_2: [SEARCH_CLUE] });
    if (url.pathname.endsWith("/analysis")) return json(analysis.body, analysis.status);
    if (url.pathname.endsWith("/trial")) return json(TRIAL);
    if (url.pathname === `/_profiler/api/profiles/${POSTS.token}`) return json(POSTS);
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0"><query-profiler-page data-base="/_profiler"></query-profiler-page><script type="module" src="/_profiler/ui.js"></script></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/_profiler/${POSTS.token}`);
  return { app: page.locator("query-profiler-page"), asked };
}

test("shows what a query's SQL alone gives away under its closed row, without asking the database", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await expect(app.locator(".clue")).toHaveText(SEARCH_CLUE.message);
  await expect(app.getByRole("button", { name: "Explain ›" })).toHaveCount(2);
  expect(asked.map((each) => each.path)).toEqual([
    `/_profiler/api/profiles/${POSTS.token}/findings`,
  ]);
});

test("opens a query's plan from its Explain link: steps, findings, and the Prisma line to copy", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  const tools = app.locator("tr.tools");
  await expect(tools.locator(".qtab.on")).toContainText("Explain plan");
  await expect(tools.locator(".said").first()).toContainText(
    "PostgreSQL 18.6 · estimated, not run",
  );
  await expect(tools.locator(".step").nth(1)).toContainText("Reads every row");
  await expect(tools.locator(".step").nth(1)).toContainText('filter: ("authorId" = $1)');
  await expect(tools.locator(".step.flagged")).toHaveCount(1);
  await expect(tools.locator(".find").first()).toContainText("Reads all 6 rows of Post");
  await expect(tools.locator(".find .line").first()).toContainText("@@index([authorId])");
  expect(asked.at(-1)).toMatchObject({
    path: `/_profiler/api/profiles/${POSTS.token}/queries/q_1/analysis`,
    header: "1",
  });
  await tools.getByRole("button", { name: "Show SQL" }).click();
  await expect(tools.locator(".find .line").nth(1)).toContainText(
    'CREATE INDEX "Post_authorId_idx"',
  );
  await tools.getByRole("button", { name: "Close ✕" }).click();
  await expect(app.locator("tr.tools")).toHaveCount(0);
});

test("opens a query from its SQL without asking the database, and keeps Explain and Measure apart", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await app.locator(".sql").first().click();
  const tools = app.locator("tr.tools");
  await expect(tools.locator(".said")).toContainText(
    "Explain plan asks the database for its estimate",
  );
  await expect(tools.getByRole("button", { name: "Copy runnable SQL" })).toBeVisible();
  expect(asked.filter((each) => each.path.includes("/queries/"))).toEqual([]);
  await tools.getByRole("button", { name: /^Explain plan/ }).click();
  await expect(tools.locator(".said").first()).toContainText("estimated, not run");
  await tools.getByRole("button", { name: /^Measure it/ }).click();
  expect(asked.at(-1)!.path).toBe(
    `/_profiler/api/profiles/${POSTS.token}/queries/q_1/analysis?measure=1`,
  );
  await tools.getByRole("button", { name: /^Explain plan/ }).click();
  // Back on Explain plan, its answer is the one kept: nothing is asked again.
  expect(asked.filter((each) => each.path.endsWith("/analysis"))).toHaveLength(1);
  await tools.getByRole("button", { name: /^Explain plan/ }).click();
  await expect(tools.locator(".qtab.on")).toHaveCount(0);
});

test("tries the suggested index by its name, and says the database is as it was", async ({
  page,
}) => {
  const { app, asked } = await open(page);
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  await app.getByRole("button", { name: "Try this index" }).click();
  await expect(app.locator(".tried")).toContainText(
    "✓ With the index, the database uses it: Index Scan, cost 1.08 → 0.14.",
  );
  await expect(app.locator(".tried")).toContainText("Created and rolled back in a transaction");
  expect(asked.at(-1)).toMatchObject({
    path: `/_profiler/api/profiles/${POSTS.token}/queries/q_1/trial`,
    header: "1",
    body: JSON.stringify({ index: "Post_authorId_idx" }),
  });
});

test("says when the trial cannot tell, instead of saying the database does not use the index", async ({
  page,
}) => {
  const { app } = await open(page);
  const why =
    "PostgreSQL does not use an index in the transaction that builds it while another transaction can still see older versions of some rows of the table, so this trial cannot tell.";
  await page.route("**/trial", (route) =>
    route.fulfill({ json: { ...TRIAL, used: false, inconclusive: why } }),
  );
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  await app.getByRole("button", { name: "Try this index" }).click();
  await expect(app.locator(".tried.inconclusive")).toContainText(why);
  await expect(app.locator(".tried")).not.toContainText("still does not use it");
});

test("keeps a table's notes apart and folded, and shows the database's own plan on demand", async ({
  page,
}) => {
  const { app } = await open(page);
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  await expect(app.locator(".fold")).toContainText(
    "About the table Post · 1 note, whatever the query",
  );
  await expect(app.locator("tr.tools")).not.toContainText("does not create one");
  await app.locator(".fold").getByRole("button", { name: "Show" }).click();
  await expect(app.locator("tr.tools")).toContainText("PostgreSQL does not create one");
  await expect(app.getByRole("link", { name: "PostgreSQL manual" })).toHaveAttribute(
    "href",
    /ddl-constraints/,
  );
  await app.getByRole("button", { name: "Show the database's plan" }).click();
  await expect(app.locator(".raw-plan")).toContainText('"Node Type": "Aggregate"');
});

test("cannot try an index on MySQL, and says why", async ({ page }) => {
  const { app } = await open(page, {
    status: 200,
    body: { ...ANALYSIS, engine: "mysql", version: "8.4.3" },
  });
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  await expect(app.getByRole("button", { name: "Try this index" })).toHaveCount(0);
  await expect(app.locator(".find").first()).toContainText(
    "MySQL and MariaDB commit a CREATE INDEX at once",
  );
});

test("shows the database's notes on a step on a line of their own, under its details", async ({
  page,
}) => {
  const read = (step: Partial<PlanStep>): PlanStep => ({
    label: "read",
    kind: "read",
    access: "index",
    children: [],
    ...step,
  });
  const { app } = await open(page, {
    status: 200,
    body: {
      ...ANALYSIS,
      engine: "mariadb",
      version: "11.4.5",
      findings: [],
      plan: {
        ...ANALYSIS.plan!,
        engine: "mariadb",
        version: "11.4.5",
        measured: true,
        steps: [
          read({
            table: "Post",
            index: "Post_authorId_idx",
            lookup: "authorId = 42",
            notes: ["Using index condition", "Using rowid filter (Post_createdAt_idx)"],
            children: [
              read({
                table: "Comment",
                index: "Comment_postId_idx",
                notes: ["Subquery cache: 996 of 1,000 runs answered from the cache"],
              }),
              read({ table: "User", access: "unique", index: "PRIMARY" }),
            ],
          }),
        ],
      },
    },
  });
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  const steps = app.locator("tr.tools .step");
  await expect(steps.nth(0).locator(".notes")).toHaveText(
    "Using index condition · Using rowid filter (Post_createdAt_idx)",
  );
  await expect(steps.nth(1).locator(".notes")).toHaveText(
    "Subquery cache: 996 of 1,000 runs answered from the cache",
  );
  await expect(steps.nth(2).locator(".notes")).toHaveCount(0);
  const details = await steps.nth(0).locator(".detail").first().boundingBox();
  const notes = await steps.nth(0).locator(".notes").boundingBox();
  expect(notes!.y).toBeGreaterThanOrEqual(details!.y + details!.height);
  expect(notes!.x).toBeCloseTo((await steps.nth(0).locator("b").boundingBox())!.x, 0);
});

test("says what the database answered when it could not plan the query", async ({ page }) => {
  const { app } = await open(page, {
    status: 422,
    body: { error: "database_error", message: 'column "nope" does not exist' },
  });
  await app.getByRole("button", { name: "Explain ›" }).first().click();
  await expect(app.locator("tr.tools")).toContainText(
    `Couldn't get the plan: column "nope" does not exist`,
  );
});
