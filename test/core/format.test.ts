import { expect, it } from "vitest";
import { formatProfile, formatWarnings, shownPath } from "../../src/core/format.js";
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

it("names the work no request started by what it is and what ran", () => {
  const profile = {
    token: "0a0b0c",
    kind: "script",
    request: { method: "", url: "prisma/seed.ts" },
    durationMs: 2140,
    warnings: [],
    summary: { queryCount: 1240, dbTimeMs: 830, operationCount: 1240, errorCount: 0 },
  } as unknown as Profile;
  expect(formatProfile(profile)).toBe(
    "[query-profiler] script prisma/seed.ts · 1,240 queries · 830 ms in db · 1,240 operations · 2140 ms · 0a0b0c",
  );
});

it("lists each warning with what ran and the line behind it, in columns", () => {
  const origin = (line: number) => [{ file: `${process.cwd()}/prisma/seed.ts`, line }];
  const profile = {
    operations: [
      { id: "op_1", model: "Post", action: "count", origin: origin(14) },
      { id: "op_2", model: "User", action: "findMany", origin: origin(20) },
    ],
    queries: [
      { id: "q_1", opId: "op_1", sql: "SELECT COUNT(*)" },
      { id: "q_9", opId: "op_2", sql: "SELECT", durationMs: 412.3 },
      {
        id: "q_10",
        sql: 'UPDATE "Post" SET "views" = "views" + 1 WHERE "id" IN (1, 2, 3)',
        origin: origin(31),
      },
    ],
    warnings: [
      { kind: "n+1", queryIds: ["q_1", "q_2", "q_3", "q_4", "q_5", "q_6"] },
      { kind: "slow", queryIds: ["q_9"] },
      { kind: "duplicate", queryIds: ["q_10", "q_11"] },
      { kind: "truncated", queryIds: [] },
    ],
    summary: { queryCount: 1000, unrecordedQueries: 59000 },
  } as unknown as Profile;
  expect(formatWarnings(profile)).toEqual([
    "N+1        Post.count, 6 times                                prisma/seed.ts:14",
    "slow       User.findMany, 412 ms                              prisma/seed.ts:20",
    'duplicate  UPDATE "Post" SET "views" = "views" + 1…, 2 times  prisma/seed.ts:31',
    "60,000 queries: the first 1,000 recorded, the rest only counted",
  ]);
});

it("says a call once, when each statement it runs is flagged on its own", () => {
  const origin = [{ file: `${process.cwd()}/prisma/seed.ts`, line: 6 }];
  const ids = (prefix: string) => [1, 2, 3, 4, 5, 6].map((n) => `${prefix}${n}`);
  const profile = {
    operations: [{ id: "op_1", model: "User", action: "create", origin }],
    queries: ["a1", "b1", "c1"].map((id) => ({ id, opId: "op_1", sql: "INSERT" })),
    warnings: ["a", "b", "c"].map((prefix) => ({ kind: "n+1", queryIds: ids(prefix) })),
    summary: { queryCount: 18 },
  } as unknown as Profile;
  expect(formatWarnings(profile)).toEqual(["N+1        User.create, 6 times  prisma/seed.ts:6"]);
});

it("shows a file from the working directory, and whole when it is outside it", () => {
  expect(shownPath(`${process.cwd()}/prisma/seed.ts`)).toBe("prisma/seed.ts");
  expect(shownPath("/elsewhere/report.ts")).toBe("/elsewhere/report.ts");
  expect(shownPath("scripts/backfill.js")).toBe("scripts/backfill.js");
});

it("ends an N+1's line with the fix that replaces the loop, and what it saves", () => {
  const origin = [{ file: `${process.cwd()}/prisma/seed.ts`, line: 6 }];
  const profile = {
    operations: [{ id: "op_1", model: "User", action: "create", origin }],
    queries: [{ id: "q_1", opId: "op_1", sql: "INSERT" }],
    warnings: [{ kind: "n+1", queryIds: ["q_1", "q_2", "q_3", "q_4", "q_5", "q_6"] }],
    summary: { queryCount: 30 },
  } as unknown as Profile;
  const fixes = { q_1: { options: [{ short: "createMany", queries: 2, instead: 30 }] } };
  expect(formatWarnings(profile, fixes)).toEqual([
    "N+1        User.create, 6 times  prisma/seed.ts:6  → createMany: 2 queries instead of 30",
  ]);
});
