import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentScope, runInScope, runWithProfile } from "../../src/core/context.js";
import {
  MAX_QUERIES,
  beginOperation,
  beginQuery,
  endProfile,
  finishOperation,
  finishQuery,
  startProfile,
} from "../../src/core/recorder.js";
import { clearProfiles, getProfile, listProfiles, onProfile } from "../../src/core/storage.js";
import { state } from "../../src/core/state.js";

const NOW = new Date("2026-11-04T09:00:00Z");
const request = { method: "GET", url: "http://localhost/orders", kind: "document" as const };
const framework = { name: "test" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(NOW);
  clearProfiles();
});
afterEach(() => vi.useRealTimers());

describe("a profile", () => {
  it("collects operations and their queries, then sums them up when it ends", () => {
    const active = startProfile(request, framework);
    const op = beginOperation(active, { model: "Order", action: "findMany", args: { take: 5 } });
    vi.advanceTimersByTime(2);
    const query = beginQuery(active, {
      sql: 'SELECT * FROM "Order" LIMIT $1',
      params: [5],
      opIds: [op.id],
    })!;
    vi.advanceTimersByTime(3);
    finishQuery(active, query);
    finishOperation(active, op);
    vi.advanceTimersByTime(5);
    const profile = endProfile(active, { status: 200 });

    expect(profile).toMatchObject({
      schemaVersion: 1,
      kind: "document",
      request: { method: "GET", url: "http://localhost/orders" },
      response: { status: 200 },
      startedAt: NOW.getTime(),
      durationMs: 10,
      summary: { queryCount: 1, dbTimeMs: 3, operationCount: 1, errorCount: 0 },
    });
    expect(profile.token).toMatch(/^[0-9a-f]{6}$/);
    expect(profile.operations[0]).toMatchObject({
      startMs: 0,
      durationMs: 5,
      queryIds: [query.id],
    });
    expect(profile.queries[0]).toMatchObject({
      opId: op.id,
      startMs: 2,
      durationMs: 3,
      params: [5],
    });
  });

  it("is stored when it ends, newest first, and listeners hear about it", () => {
    const heard: string[] = [];
    const stop = onProfile((profile) => heard.push(profile.token));
    const first = endProfile(startProfile(request, framework));
    const second = endProfile(startProfile(request, framework));
    stop();
    endProfile(startProfile(request, framework));

    expect(
      listProfiles()
        .slice(1, 3)
        .map((p) => p.token),
    ).toEqual([second.token, first.token]);
    expect(getProfile(first.token)).toBe(first);
    expect(heard).toEqual([first.token, second.token]);
  });

  it("keeps only the last ones", () => {
    state().limit = 3;
    for (let i = 0; i < 5; i += 1) endProfile(startProfile(request, framework));
    expect(listProfiles()).toHaveLength(3);
    state().limit = 100;
  });

  it("ends only once", () => {
    const active = startProfile(request, framework);
    endProfile(active, { status: 200 });
    endProfile(active, { status: 500 });
    expect(listProfiles()).toHaveLength(1);
    expect(listProfiles()[0]!.response).toEqual({ status: 200 });
  });

  it("stops recording queries past the limit and says so", () => {
    const active = startProfile(request, framework);
    for (let i = 0; i <= MAX_QUERIES; i += 1) beginQuery(active, { sql: "SELECT 1" });
    const profile = endProfile(active);
    expect(profile.queries).toHaveLength(MAX_QUERIES);
    expect(profile.warnings).toContainEqual({ kind: "truncated", queryIds: [] });
  });

  it("ties a query to every operation it answers (Prisma compacts some into one)", () => {
    const active = startProfile(request, framework);
    const a = beginOperation(active, { model: "User", action: "findUnique" });
    const b = beginOperation(active, { model: "User", action: "findUnique" });
    const query = beginQuery(active, { sql: "SELECT", opIds: [a.id, b.id] })!;
    expect(query.opId).toBe(a.id);
    expect([a.queryIds, b.queryIds]).toEqual([[query.id], [query.id]]);
  });

  it("counts a failed operation once, even when its query failed too", () => {
    const active = startProfile(request, framework);
    const op = beginOperation(active, { model: "User", action: "create" });
    const query = beginQuery(active, { sql: "INSERT", opIds: [op.id] })!;
    finishQuery(active, query, Object.assign(new Error("duplicate key"), { code: "23505" }));
    finishOperation(active, op, new Error("Unique constraint failed"));
    const raw = beginQuery(active, { sql: "SELECT broken" })!;
    finishQuery(active, raw, "syntax error");
    expect(endProfile(active).summary.errorCount).toBe(2);
    expect(query.error).toEqual({ message: "duplicate key", code: "23505" });
  });
});

describe("the request context", () => {
  it("is the profile inside, nothing outside, and nothing once it ended", async () => {
    const active = startProfile(request, framework);
    expect(currentScope()).toBeUndefined();
    await runWithProfile(active, async () => {
      await Promise.resolve();
      expect(currentScope()?.profile).toBe(active);
      await runInScope({ opId: "op_1" }, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        expect(currentScope()).toMatchObject({ profile: active, opId: "op_1" });
      });
      expect(currentScope()?.opId).toBeUndefined();
      endProfile(active);
      expect(currentScope()).toBeUndefined();
    });
  });

  it("outside a profile, a scope patch just runs the function", () => {
    expect(runInScope({ opId: "op_1" }, () => currentScope())).toBeUndefined();
  });
});
