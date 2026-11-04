import { readFileSync } from "node:fs";
import { endProfile, runWithProfile, startProfile, type Profile } from "../../src/core/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { profilePool, profilePrisma, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

// Prisma's statements come through its adapter; the pool is profiled too, for raw SQL, as an app with both would.
const pool = profilePool(new pg.Pool({ connectionString: TEST_DATABASE_URL }));
const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })));

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

async function profiled(fn: () => Promise<unknown>): Promise<Profile> {
  const active = startProfile(
    { method: "GET", url: "http://localhost/orders", kind: "document" },
    { name: "test" },
  );
  await runWithProfile(active, async () => {
    await fn().catch(() => undefined);
  });
  return endProfile(active, { status: 200 });
}

let userId = 0;
beforeEach(async () => {
  await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
  userId = (await prisma.user.create({ data: { email: "a@example.test" } })).id;
  await prisma.order.create({ data: { userId, total: 10, status: "paid" } });
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("capturing a request's database work", () => {
  it("records a Prisma operation and the SQL it ran, without the stamp", async () => {
    const profile = await profiled(async () => {
      await prisma.order.findMany({ where: { status: "paid" } }); // findMany-call
    });
    const [op] = profile.operations;
    const [query] = profile.queries;
    expect(op).toMatchObject({
      model: "Order",
      action: "findMany",
      args: { where: { status: "paid" } },
      queryIds: [query!.id],
    });
    expect(op!.origin![0]).toMatchObject({ line: lineOf("// findMany-call") });
    expect(op!.origin![0]!.file).toMatch(/capture\.test\.ts$/);
    expect(query).toMatchObject({ opId: op!.id, params: ["paid", "0"] });
    expect(query!.sql).toMatch(/^SELECT .* FROM "public"\."Order" WHERE/);
    expect(query!.sql).not.toContain("/*");
    expect(query!.durationMs).toBeGreaterThan(0);
  });

  it("records raw SQL through the pool or a client, with the line that sent it", async () => {
    const profile = await profiled(async () => {
      await pool.query('SELECT count(*) FROM "Order" WHERE status = $1', ["paid"]); // pool-call
      const client = await pool.connect();
      try {
        await client.query("SELECT $1::int AS one", [1]); // client-call
      } finally {
        client.release();
      }
    });
    expect(profile.operations).toEqual([]);
    expect(profile.queries.map((q) => [q.opId, q.params, q.origin?.[0]?.line])).toEqual([
      [undefined, ["paid"], lineOf("// pool-call")],
      [undefined, [1], lineOf("// client-call")],
    ]);
  });

  it("does not take the SQL that runs after a Prisma call for part of it", async () => {
    const profile = await profiled(async () => {
      await prisma.user.findMany();
      await pool.query("SELECT 2");
    });
    expect(profile.queries.map((q) => q.opId)).toEqual([profile.operations[0]!.id, undefined]);
  });

  it("gives a statement Prisma compacted from several findUnique to all of them", async () => {
    const profile = await profiled(() =>
      Promise.all([1, 2, 3].map((id) => prisma.user.findUnique({ where: { id } }))),
    );
    expect(profile.queries).toHaveLength(1);
    const [query] = profile.queries;
    expect(profile.operations.map((op) => op.queryIds)).toEqual([
      [query!.id],
      [query!.id],
      [query!.id],
    ]);
  });

  it("in a batch transaction, gives each statement to its own operation", async () => {
    const profile = await profiled(() =>
      prisma.$transaction([prisma.user.count(), prisma.order.count()]),
    );
    const [users, orders] = profile.operations;
    const statement = (table: string) =>
      profile.queries.find((q) => q.sql.includes(`"public"."${table}"`))!;
    expect(statement("User").opId).toBe(users!.id);
    expect(statement("Order").opId).toBe(orders!.id);
    const control = profile.queries.filter((q) => /^(BEGIN|COMMIT)/.test(q.sql));
    expect(control.map((q) => q.opId)).toEqual([undefined, undefined]);
    expect(new Set(profile.queries.map((q) => q.txId)).size).toBe(1);
    expect(profile.queries[0]!.txId).toMatch(/^tx_/);
  });

  it("in an interactive transaction, keeps each statement with its operation and its transaction", async () => {
    const profile = await profiled(() =>
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: "b@example.test" } }); // tx-user
        await tx.order.create({ data: { userId: user.id, total: 5, status: "new" } }); // tx-order
      }),
    );
    const linked = profile.queries.filter((q) => q.opId);
    expect(linked.map((q) => profile.operations.find((op) => op.id === q.opId)?.model)).toEqual([
      "User",
      "Order",
    ]);
    expect(profile.queries.map((q) => q.sql.split(" ")[0])).toEqual([
      "BEGIN",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
    expect(new Set(profile.queries.map((q) => q.txId)).size).toBe(1);
    expect(profile.operations.map((op) => op.origin?.[0]?.line)).toEqual([
      lineOf("// tx-user"),
      lineOf("// tx-order"),
    ]);
  });

  it("keeps the error of a failed operation and of its statement", async () => {
    const profile = await profiled(() => prisma.user.create({ data: { email: "a@example.test" } }));
    expect(profile.operations[0]!.error?.message).toMatch(/Unique constraint/);
    expect(profile.queries[0]!.error).toMatchObject({ code: "23505" });
    expect(profile.summary.errorCount).toBe(1);
  });

  it("keeps two requests at the same time apart", async () => {
    const [users, orders] = await Promise.all([
      profiled(() => prisma.user.findMany()),
      profiled(() => prisma.order.findMany()),
    ]);
    expect(users.operations.map((op) => op.model)).toEqual(["User"]);
    expect(orders.operations.map((op) => op.model)).toEqual(["Order"]);
    expect(users.queries).toHaveLength(1);
    expect(orders.queries).toHaveLength(1);
  });

  it("records nothing outside a request, and still works", async () => {
    const before = await profiled(async () => undefined);
    expect(await prisma.user.count()).toBe(1);
    expect((await pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
    expect(before.queries).toEqual([]);
  });
});
