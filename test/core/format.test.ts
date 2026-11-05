import { expect, it } from "vitest";
import { formatProfile } from "../../src/core/format.js";
import type { Profile } from "../../src/core/profile.js";

it("sums a profile up in one line", () => {
  const profile = {
    token: "a1b2c3",
    request: { method: "GET", url: "/orders" },
    response: { status: 200 },
    durationMs: 312,
    warnings: [{ kind: "n+1", queryIds: [] }],
    summary: { queryCount: 12, dbTimeMs: 48.7, operationCount: 7, errorCount: 0 },
  } as unknown as Profile;
  expect(formatProfile(profile)).toBe(
    "[query-profiler] GET /orders 200 · 12 queries · 48.7 ms in db · 7 operations · 1 warning · 312 ms · a1b2c3",
  );
});

it("says one query and one operation in the singular", () => {
  const profile = {
    token: "d4e5f6",
    request: { method: "GET", url: "/" },
    response: { status: 200 },
    durationMs: 3,
    warnings: [],
    summary: { queryCount: 1, dbTimeMs: 1.2, operationCount: 1, errorCount: 0 },
  } as unknown as Profile;
  expect(formatProfile(profile)).toBe(
    "[query-profiler] GET / 200 · 1 query · 1.2 ms in db · 1 operation · 3 ms · d4e5f6",
  );
});
