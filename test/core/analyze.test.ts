import { describe, expect, it } from "vitest";
import { analyze, busyMs } from "../../src/core/analyze.js";
import { fingerprint } from "../../src/core/fingerprint.js";
import type { Profile, QueryRecord } from "../../src/core/profile.js";

let next = 0;
const query = (sql: string, params: unknown[] = [], startMs = 0, durationMs = 1): QueryRecord => ({
  id: `q_${++next}`,
  sql,
  params,
  fingerprint: fingerprint(sql),
  startMs,
  durationMs,
});
const profileOf = (queries: QueryRecord[]) => ({ queries }) as Profile;

describe("analyze", () => {
  it("flags the same statement shape repeated five times as N+1", () => {
    const repeated = [1, 2, 3, 4, 5].map((id) =>
      query(`SELECT * FROM "Order" WHERE "userId" = $1`, [id]),
    );
    const warnings = analyze(profileOf([...repeated, query("SELECT 1")]));
    expect(warnings).toEqual([
      { kind: "n+1", fingerprint: repeated[0]!.fingerprint, queryIds: repeated.map((q) => q.id) },
    ]);
  });

  it("flags the same SQL with the same params as a duplicate", () => {
    const a = query("SELECT * FROM t WHERE id = $1", [7]);
    const b = query("SELECT * FROM t WHERE id = $1", [7]);
    const other = query("SELECT * FROM t WHERE id = $1", [8]);
    expect(analyze(profileOf([a, b, other]))).toEqual([
      { kind: "duplicate", fingerprint: a.fingerprint, queryIds: [a.id, b.id] },
    ]);
  });

  it("flags slow queries, from 100 ms", () => {
    const slow = query("SELECT pg_sleep(1)", [], 0, 100);
    expect(analyze(profileOf([slow, query("SELECT 1", [], 0, 99.9)]))).toEqual([
      { kind: "slow", fingerprint: slow.fingerprint, queryIds: [slow.id] },
    ]);
  });

  it("ignores transaction control, which repeats by nature", () => {
    expect(
      analyze(profileOf(["BEGIN", "COMMIT", "BEGIN", "COMMIT"].map((sql) => query(sql)))),
    ).toEqual([]);
  });
});

describe("busyMs", () => {
  it("counts overlapping queries once", () => {
    expect(busyMs([query("a", [], 0, 10), query("b", [], 5, 10), query("c", [], 20, 5)])).toBe(20);
  });

  it("is zero without finished queries", () => {
    expect(busyMs([{ ...query("a"), durationMs: undefined }])).toBe(0);
  });
});
