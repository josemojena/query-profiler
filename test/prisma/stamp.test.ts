import { startProfile, beginOperation } from "../../src/core/index.js";
import { describe, expect, it } from "vitest";
import { linkOperations, readStamp, stampPlugin } from "../../src/prisma/stamp.js";

describe("the stamp", () => {
  it("names the operation, marking compacted batches and raw queries", () => {
    expect(
      stampPlugin({ query: { type: "single", modelName: "Order", action: "findMany" } }),
    ).toEqual({ query_profiler: "Order.findMany" });
    expect(
      stampPlugin({ query: { type: "compacted", modelName: "User", action: "findUnique" } }),
    ).toEqual({ query_profiler: "*User.findUnique" });
    expect(stampPlugin({ query: { type: "single", action: "queryRaw" } })).toEqual({
      query_profiler: ".queryRaw",
    });
  });

  it("is read and removed, wherever Prisma put it", () => {
    expect(readStamp(`/*query_profiler='Order.findMany'*/ SELECT 1`)).toEqual({
      sql: "SELECT 1",
      stamp: { model: "Order", action: "findMany", compacted: false },
    });
    expect(readStamp(`SELECT 1 /*query_profiler='%2AUser.findUnique'*/`)).toEqual({
      sql: "SELECT 1",
      stamp: { model: "User", action: "findUnique", compacted: true },
    });
    expect(readStamp(`SELECT 1 /*query_profiler='.queryRaw'*/`).stamp).toEqual({
      model: undefined,
      action: "queryRaw",
      compacted: false,
    });
  });

  it("leaves other comments and other sqlcommenter tags alone", () => {
    expect(readStamp(`/*app='web',query_profiler='User.findMany'*/ SELECT 1 /* hint */`).sql).toBe(
      `/*app='web'*/ SELECT 1 /* hint */`,
    );
    expect(readStamp(`SELECT 1`)).toEqual({ sql: "SELECT 1" });
  });
});

describe("linking a statement to its operations", () => {
  const request = { method: "GET", url: "/", kind: "document" as const };

  it("takes the operation from the context when the stamp agrees, otherwise the open one the stamp names", () => {
    const active = startProfile(request, { name: "test" });
    const users = beginOperation(active, { model: "User", action: "count" });
    const orders = beginOperation(active, { model: "Order", action: "count" });
    const stamp = { model: "Order", action: "aggregate", compacted: false };
    expect(linkOperations(active, "SELECT", stamp, users.id)).toEqual([orders.id]);
    expect(linkOperations(active, "SELECT", { ...stamp, model: "User" }, users.id)).toEqual([
      users.id,
    ]);
  });

  it("without a stamp, trusts the context, but never for transaction control", () => {
    const active = startProfile(request, { name: "test" });
    const op = beginOperation(active, { model: "User", action: "findMany" });
    expect(linkOperations(active, "SELECT 1", undefined, op.id)).toEqual([op.id]);
    expect(linkOperations(active, "BEGIN", undefined, op.id)).toEqual([]);
    expect(linkOperations(active, "SELECT 1", undefined, undefined)).toEqual([]);
  });
});
