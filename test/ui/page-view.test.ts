import { toListItem, type Profile, type ProfileListItem } from "../../src/core/index.js";
import { describe, expect, it } from "vitest";
import { renderPage, tree, type PageState } from "../../src/ui/page-view.js";

const item = (token: string, url: string, parentToken?: string, status = 200): ProfileListItem => ({
  schemaVersion: 1,
  token,
  ...(parentToken ? { parentToken } : {}),
  kind: parentToken ? "data" : "document",
  request: { method: "GET", url },
  response: { status },
  startedAt: 0,
  durationMs: 10,
  framework: { name: "react-router" },
  summary: { queryCount: 2, dbTimeMs: 3, operationCount: 1, errorCount: 0 },
  warningCount: 0,
});

// Newest first, as the API lists them.
const list = [
  item("cccccc", "/api/suggestions", "aaaaaa"),
  item("bbbbbb", "/api/promotions", "aaaaaa"),
  item("dddddd", "/users", undefined, 500),
  item("aaaaaa", "/products"),
];

const profile: Profile = {
  ...item("aaaaaa", "/products"),
  operations: [],
  queries: [],
  warnings: [{ kind: "n+1", queryIds: [] }],
};

const state = (patch: Partial<PageState> = {}): PageState => ({
  base: "/_profiler",
  root: "/repo",
  editor: "vscode",
  expanded: new Set(),
  list,
  filter: "",
  view: "requests",
  tab: "queries",
  profile,
  ...patch,
});

describe("the request list", () => {
  it("puts each page's calls under it, oldest first", () => {
    expect(tree(list, "").map(([root, calls]) => [root.token, calls.map((c) => c.token)])).toEqual([
      ["dddddd", []],
      ["aaaaaa", ["bbbbbb", "cccccc"]],
    ]);
  });

  it("keeps a page when it or one of its calls matches, by path or status", () => {
    expect(tree(list, "promo").map(([root]) => root.token)).toEqual(["aaaaaa"]);
    expect(tree(list, "500").map(([root]) => root.token)).toEqual(["dddddd"]);
    expect(tree(list, "nothing")).toEqual([]);
  });
});

describe("the profiler page", () => {
  it("shows the request picked, its cards and the calls it made", () => {
    const html = renderPage(state());
    expect(html).toContain("<h1>GET /products");
    expect(html).toContain("warnings: N+1");
    expect(html).toContain("Calls from this page");
    expect(html).toContain('href="/_profiler/bbbbbb"');
    expect(html).toContain('download="query-profiler-aaaaaa.json"');
    expect(html).toMatch(/class="item on"[^>]*>|data-action="go" class="item on"/);
  });

  it("links a call back to its page", () => {
    const call: Profile = {
      ...profile,
      ...item("bbbbbb", "/api/promotions", "aaaaaa"),
      warnings: [],
    };
    expect(renderPage(state({ profile: call }))).toContain(
      'called from <a href="/_profiler/aaaaaa"',
    );
  });

  it("shows the stats", () => {
    const html = renderPage(
      state({
        view: "stats",
        stats: {
          profiles: 4,
          slowest: [
            {
              fingerprint: "f",
              sql: "SELECT <b>",
              count: 2,
              totalMs: 9,
              maxMs: 7,
              token: "aaaaaa",
            },
          ],
          repeated: [],
          models: [{ model: "Order", operations: 3, totalMs: 12 }],
          routes: [{ path: "/products", requests: 2, queries: 4, dbTimeMs: 6, warnings: 1 }],
        },
      }),
    );
    expect(html).toContain("Across the last 4 requests");
    expect(html).toContain("SELECT &lt;b&gt;");
    expect(html).toContain("<b>Order</b>");
  });

  it("says so when there is nothing yet", () => {
    expect(renderPage(state({ list: [], profile: undefined }))).toContain("No requests yet");
  });
});

it("keeps the list item shape the API sends", () => {
  expect(Object.keys(toListItem(profile)).sort()).toEqual(Object.keys(item("x", "/")).sort());
});
