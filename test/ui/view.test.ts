import {
  analyze,
  fingerprint,
  toListItem,
  type Profile,
  type QueryRecord,
} from "../../src/core/index.js";
import { describe, expect, it } from "vitest";
import { queryRows } from "../../src/ui/detail.js";
import { render, totals, type ViewState } from "../../src/ui/view.js";

const query = (id: string, sql: string, opId?: string, durationMs = 2): QueryRecord => ({
  id,
  sql,
  params: [],
  fingerprint: fingerprint(sql),
  startMs: 1,
  durationMs,
  opId,
});

function profileWith(queries: QueryRecord[]): Profile {
  const profile: Profile = {
    schemaVersion: 1,
    token: "a1b2c3",
    kind: "document",
    request: { method: "GET", url: "/orders" },
    response: { status: 200 },
    startedAt: 0,
    durationMs: 40,
    framework: { name: "react-router" },
    operations: [
      {
        id: "op_1",
        model: "Order",
        action: "findMany",
        startMs: 0,
        durationMs: 5,
        queryIds: ["q_1"],
        origin: [{ file: "/repo/app/orders.server.ts", line: 31 }],
      },
    ],
    queries,
    warnings: [],
    summary: { queryCount: queries.length, dbTimeMs: 12.5, operationCount: 1, errorCount: 0 },
  };
  profile.warnings = analyze(profile);
  return profile;
}

const state = (profile: Profile | undefined, patch: Partial<ViewState> = {}): ViewState => ({
  base: "/_profiler",
  root: "/repo",
  editor: "vscode",
  profile,
  page: profile && toListItem(profile),
  calls: [],
  recent: [],
  open: false,
  minimized: false,
  showRecent: false,
  pinned: false,
  tab: "queries",
  height: 300,
  theme: "dark",
  expanded: new Set(),
  ...patch,
});

describe("the bar", () => {
  it("sums the request up when closed", () => {
    const html = render(state(profileWith([query("q_1", "SELECT 1", "op_1")])));
    expect(html).toContain("GET 200");
    expect(html).toContain("/orders");
    expect(html).toContain("<b>1</b> queries");
    expect(html).toContain("<b>12.5 ms</b> in DB");
    expect(html).not.toContain('class="panel"');
  });

  it("says so when the page has no profile yet", () => {
    expect(render(state(undefined))).toContain("No profile for this page yet");
  });

  it("opens into tabs, with the queries first", () => {
    const html = render(state(profileWith([query("q_1", "SELECT 1", "op_1")]), { open: true }));
    expect(html).toContain('class="panel"');
    expect(html).toContain("Queries (1)");
    expect(html).toContain("Order.findMany");
    expect(html).toContain(">app/orders.server.ts:31</span>");
    expect(html).toContain('href="vscode://file/repo/app/orders.server.ts:31:1"');
  });

  it("shrinks to a pill", () => {
    const html = render(state(profileWith([query("q_1", "SELECT 1")]), { minimized: true }));
    expect(html).toContain('class="pill"');
    expect(html).not.toContain('class="strip"');
  });

  it("never lets the SQL or the parameters write HTML", () => {
    const evil = query("q_1", `SELECT '<img src=x onerror=alert(1)>'`);
    const html = render(state(profileWith([{ ...evil, params: ["<script>"] }]), { open: true }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("query rows", () => {
  it("collapse an N+1 into one row and keep the rest one per query", () => {
    const repeated = [1, 2, 3, 4, 5].map((n) =>
      query(`q_${n + 1}`, `SELECT * FROM "Order" WHERE "userId" = $1`),
    );
    const profile = profileWith([query("q_1", "SELECT 1"), ...repeated, query("q_9", "SELECT 2")]);
    expect(queryRows(profile).map((row) => [row.queries.length, row.repeated])).toEqual([
      [1, false],
      [5, true],
      [1, false],
    ]);
    const html = render(state(profile, { open: true }));
    expect(html).toContain("N+1 ×5");
    expect(html).toContain("5 times from the same place");
  });

  it("mark slow queries", () => {
    const html = render(
      state(profileWith([query("q_1", "SELECT pg_sleep(1)", undefined, 112.4)]), { open: true }),
    );
    expect(html).toContain('<span class="badge slow">slow</span>');
  });
});

describe("the other tabs", () => {
  const profile = profileWith([query("q_1", "SELECT 1", "op_1"), query("q_2", "BEGIN")]);

  it("draw the timeline over the request's duration", () => {
    const html = render(state(profile, { open: true, tab: "timeline" }));
    expect(html).toContain("Order.findMany");
    expect(html).toContain("40 ms");
  });

  it("explain each warning", () => {
    const repeated = [1, 2, 3, 4, 5].map((n) => query(`q_${n}`, `SELECT * FROM t WHERE id = $1`));
    const html = render(state(profileWith(repeated), { open: true, tab: "warnings" }));
    expect(html).toContain("ran 5 times: likely an N+1");
  });

  it("show the request and where its JSON is", () => {
    const html = render(state(profile, { open: true, tab: "request" }));
    expect(html).toContain('href="/_profiler/api/profiles/a1b2c3"');
    expect(html).toContain("X-Debug-Token");
  });
});

describe("a page and its calls", () => {
  const page = profileWith([query("q_1", "SELECT 1", "op_1")]);
  const call = (token: string, url: string, queryCount: number) => ({
    ...toListItem(page),
    token,
    parentToken: page.token,
    kind: "data" as const,
    request: { method: "GET", url },
    summary: { queryCount, dbTimeMs: 2, operationCount: 1, errorCount: 0 },
    warningCount: 1,
  });
  const calls = [call("c0ffee", "/api/promotions", 3), call("d00d1e", "/api/suggestions", 2)];

  it("adds up in the strip", () => {
    expect(totals({ page: toListItem(page), calls })).toEqual({
      requests: 3,
      queries: 6,
      dbTimeMs: 16.5,
      warnings: 2,
      errors: 0,
    });
    const html = render(state(page, { calls }));
    expect(html).toContain("<b>2</b> calls");
    expect(html).toContain("<b>6</b> queries");
  });

  it("show as a tree: the page, then each call under it", () => {
    const html = render(state(page, { calls, open: true, tab: "requests" }));
    expect(html).toContain("Requests (3)");
    const rows = html.match(
      /<tr class="(main|child)[^"]*" data-action="select" data-token="([0-9a-f]+)"/g,
    );
    expect(rows).toEqual([
      '<tr class="main on" data-action="select" data-token="a1b2c3"',
      '<tr class="child" data-action="select" data-token="c0ffee"',
      '<tr class="child" data-action="select" data-token="d00d1e"',
    ]);
    expect(html).toContain("/api/promotions");
  });

  it("hang from one line, which ends at the last call", () => {
    const html = render(state(page, { calls, open: true, tab: "requests" }));
    expect(html.match(/<span class="branch[^"]*">/g)).toEqual([
      '<span class="branch">',
      '<span class="branch last">',
    ]);
  });
});

describe("the theme switch", () => {
  it("marks the theme in use", () => {
    const html = render(state(profileWith([]), { theme: "light" }));
    expect(html.match(/data-choice="(\w+)" aria-pressed="true"/g)).toEqual([
      'data-choice="light" aria-pressed="true"',
    ]);
    expect(html).toContain('data-choice="dark" aria-pressed="false"');
    expect(html).toContain('data-choice="system" aria-pressed="false"');
  });
});
