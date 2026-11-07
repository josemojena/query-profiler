import { describe, expect, it } from "vitest";
import { fingerprint } from "../../src/core/fingerprint.js";
import type { Profile } from "../../src/core/profile.js";
import { stats } from "../../src/core/stats.js";

function profile(
  token: string,
  url: string,
  queries: [string, number][],
  ops: [string, number][] = [],
): Profile {
  return {
    token,
    request: { method: "GET", url },
    queries: queries.map(([sql, durationMs], i) => ({
      id: `q_${i}`,
      sql,
      params: [],
      fingerprint: fingerprint(sql),
      startMs: 0,
      durationMs,
    })),
    operations: ops.map(([model, durationMs], i) => ({
      id: `op_${i}`,
      model,
      action: "findMany",
      startMs: 0,
      durationMs,
      queryIds: [],
    })),
    warnings: [{ kind: "slow", queryIds: [] }],
    summary: {
      queryCount: queries.length,
      dbTimeMs: queries.reduce((t, [, ms]) => t + ms, 0),
      operationCount: ops.length,
      errorCount: 0,
    },
  } as unknown as Profile;
}

describe("stats", () => {
  const profiles = [
    profile(
      "aaaaaa",
      "/orders?page=1",
      [
        ["SELECT * FROM o WHERE id = $1", 2],
        ["SELECT count(*) FROM o", 120],
      ],
      [["Order", 125]],
    ),
    profile(
      "bbbbbb",
      "/orders?page=2",
      [
        ["SELECT * FROM o WHERE id = $2", 3],
        ["SELECT * FROM o WHERE id = $1", 1],
      ],
      [
        ["Order", 5],
        ["User", 2],
      ],
    ),
    profile("cccccc", "/users", [["SELECT * FROM u", 4]], [["User", 4]]),
  ];
  const result = stats(profiles);

  it("ranks statement shapes by their slowest run, pointing at that profile", () => {
    expect(result.slowest[0]).toMatchObject({
      sql: "SELECT count(*) FROM o",
      maxMs: 120,
      count: 1,
      token: "aaaaaa",
    });
    expect(result.slowest).toHaveLength(3);
  });

  it("ranks them by how often they ran, across requests", () => {
    expect(result.repeated[0]).toMatchObject({ count: 3, totalMs: 6, maxMs: 3, token: "bbbbbb" });
  });

  it("adds up time by model and by route, without the query string", () => {
    expect(result.models).toEqual([
      { model: "Order", operations: 2, totalMs: 130 },
      { model: "User", operations: 2, totalMs: 6 },
    ]);
    expect(result.routes).toEqual([
      { path: "/orders", requests: 2, queries: 4, dbTimeMs: 126, warnings: 2 },
      { path: "/users", requests: 1, queries: 1, dbTimeMs: 4, warnings: 1 },
    ]);
    expect(result.profiles).toBe(3);
  });

  it("counts each kind of profile, and lists by route only what requests asked for", () => {
    const seed = { ...profile("dddddd", "prisma/seed.ts", [["INSERT INTO u", 9]]), kind: "script" };
    const page = { ...profile("eeeeee", "/orders", [["SELECT 1", 1]]), kind: "document" };
    const both = stats([seed, page] as Profile[]);
    expect(both.kinds).toEqual({ script: 1, document: 1 });
    expect(both.routes.map((route) => route.path)).toEqual(["/orders"]);
    expect(both.slowest.map((stat) => stat.sql)).toContain("INSERT INTO u");
  });
});
