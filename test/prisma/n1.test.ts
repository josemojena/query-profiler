import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { n1Fixes, type N1Fix } from "../../src/analysis/n1.js";
import { readSchema } from "../../src/analysis/schema.js";
import {
  createHandler,
  endProfile,
  runWithProfile,
  startProfile,
  type Profile,
} from "../../src/core/index.js";
import { profilePool, profilePrisma, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

const pool = profilePool(new pg.Pool({ connectionString: TEST_DATABASE_URL }));
const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })));
const SCHEMA = readSchema(
  readFileSync(new URL("fixture/schema.prisma", import.meta.url), "utf8"),
  "schema.prisma",
);

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

async function profiled(fn: () => Promise<unknown>): Promise<Profile> {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await fn();
  });
  return endProfile(active, { status: 200 });
}

/** The only N+1 fix of a profile: a call that runs several statements has one for each. */
function fixOf(profile: Profile, schema = SCHEMA): N1Fix {
  const fixes = new Set(Object.values(n1Fixes(profile, schema)).map((fix) => JSON.stringify(fix)));
  expect(fixes.size).toBe(1);
  return JSON.parse([...fixes][0]!) as N1Fix;
}

const code = (fix: N1Fix, option = 0) =>
  fix.options[option]!.lines.map((line) => line.text).join("\n");
const added = (fix: N1Fix, option = 0) =>
  fix.options[option]!.lines.filter((line) => line.added).map((line) => line.text.trim());

// The code a fix suggests, run against the same database, as the app would paste it.
const AsyncFunction = (async () => {}).constructor as new (
  ...args: string[]
) => (client: unknown) => Promise<unknown>;
const run = (text: string) =>
  new AsyncFunction("prisma", text.includes(";") ? text : `return ${text}`)(prisma);

let ids: number[] = [];
beforeEach(async () => {
  await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
  const users = await prisma.user.createManyAndReturn({
    data: [1, 2, 3, 4, 5].map((n) => ({ email: `user${n}@example.test` })),
  });
  ids = users.map((user) => user.id);
  await prisma.order.createMany({
    data: ids.flatMap((userId) => [
      { userId, total: 10, status: "paid" },
      { userId, total: 20, status: "open" },
    ]),
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe("a count in a loop", () => {
  it("is fixed with _count in the read the ids came from, or with one groupBy", async () => {
    const profile = await profiled(async () => {
      const users = await prisma.user.findMany({ orderBy: { id: "asc" } }); // users-line
      for (const user of users) await prisma.order.count({ where: { userId: user.id } }); // count-line
    });
    const fix = fixOf(profile);
    expect(fix).toMatchObject({
      operation: "Order.count",
      times: 5,
      origin: { line: lineOf("// count-line") },
      varying: { path: "userId", values: ids, count: 5 },
      source: { operation: "User.findMany", origin: { line: lineOf("// users-line") }, rows: 5 },
      relation: "Order.userId points to User",
    });
    expect(
      fix.options.map(({ title, short, queries, instead }) => [title, short, queries, instead]),
    ).toEqual([
      ["In the query before", "include", 1, 6],
      ["One query for all of them", "groupBy", 2, 6],
    ]);
    expect(code(fix)).toBe(
      `prisma.user.findMany({\n  orderBy: { id: "asc" },\n  include: { _count: { select: { orders: true } } },\n})`,
    );
    expect(added(fix)).toEqual(["include: { _count: { select: { orders: true } } },"]);
    const withCount = (await run(code(fix))) as { _count: { orders: number } }[];
    expect(withCount.map((user) => user._count.orders)).toEqual([2, 2, 2, 2, 2]);
    const grouped = (await run(code(fix, 1))) as { _count: { _all: number } }[];
    expect(grouped.map((group) => group._count._all)).toEqual([2, 2, 2, 2, 2]);
  });

  it("keeps the loop's other conditions in the include and in the groupBy", async () => {
    const profile = await profiled(async () => {
      const users = await prisma.user.findMany();
      for (const user of users)
        await prisma.order.count({ where: { userId: user.id, status: "paid" } });
    });
    const fix = fixOf(profile);
    expect(added(fix)).toEqual([
      "include: {",
      '_count: { select: { orders: { where: { status: "paid" } } } },',
      "},",
    ]);
    const withCount = (await run(code(fix))) as { _count: { orders: number } }[];
    expect(withCount.map((user) => user._count.orders)).toEqual([1, 1, 1, 1, 1]);
    expect(code(fix, 1)).toContain(`status: "paid"`);
  });
});

describe("a read in a loop", () => {
  it("loads each row's parent with include, or every parent with one findMany", async () => {
    const profile = await profiled(async () => {
      const orders = await prisma.order.findMany({ where: { status: "paid" } });
      for (const order of orders) await prisma.user.findUnique({ where: { id: order.userId } });
    });
    const fix = fixOf(profile);
    expect(fix).toMatchObject({
      operation: "User.findUnique",
      source: { operation: "Order.findMany", rows: 5 },
      relation: "Order.userId points to User",
    });
    expect(code(fix)).toBe(
      `prisma.order.findMany({\n  where: { status: "paid" },\n  include: { user: true },\n})`,
    );
    expect(fix.options[0]).toMatchObject({ queries: 2, instead: 6 });
    const orders = (await run(code(fix))) as { user: { id: number } }[];
    expect(orders.map((order) => order.user.id)).toEqual(ids);
    expect(code(fix, 1)).toBe(
      `prisma.user.findMany({ where: { id: { in: [${ids.join(", ")}] } } })`,
    );
  });

  it("loads each parent's rows with include, the loop's conditions and order kept", async () => {
    const profile = await profiled(async () => {
      const users = await prisma.user.findMany();
      for (const user of users)
        await prisma.order.findMany({ where: { userId: user.id }, orderBy: { total: "desc" } });
    });
    const fix = fixOf(profile);
    expect(added(fix)).toEqual(['include: { orders: { orderBy: { total: "desc" } } },']);
    const users = (await run(code(fix))) as { orders: { total: number }[] }[];
    expect(users[0]!.orders.map((order) => order.total)).toEqual([20, 10]);
  });

  it("writes a stand-in for many values, and no include without the schema", async () => {
    const many = await prisma.user.createManyAndReturn({
      data: Array.from({ length: 12 }, (_, n) => ({ email: `more${n}@example.test` })),
    });
    const profile = await profiled(async () => {
      for (const user of many) await prisma.order.findMany({ where: { userId: user.id } });
    });
    const fix = fixOf(profile, undefined);
    expect(fix.source).toBeUndefined();
    expect(fix.options.map((option) => option.short)).toEqual(["findMany with in"]);
    expect(code(fix)).toContain(
      `in: userIds /* 12 values: ${many[0]!.id}, ${many[1]!.id}, ${many[2]!.id}, … */`,
    );
  });

  it("says so when the loop pages each call on its own", async () => {
    const profile = await profiled(async () => {
      for (const id of ids) await prisma.order.findMany({ where: { userId: id }, take: 1 });
    });
    expect(fixOf(profile, undefined)).toMatchObject({
      options: [],
      note: "Each call pages on its own (take): one query would page them all together.",
    });
  });
});

describe("a write in a loop", () => {
  it("creates them together with createMany", async () => {
    const profile = await profiled(async () => {
      for (const n of [6, 7, 8, 9, 10])
        await prisma.user.create({ data: { email: `u${n}@example.test` } });
    });
    const fix = fixOf(profile);
    expect(fix.options[0]).toMatchObject({ short: "createMany", queries: 1, instead: 5 });
    expect(code(fix)).toBe(
      `prisma.user.createMany({\n  data: [\n    { email: "u6@example.test" },\n    { email: "u7@example.test" },\n    // … 3 more, as in the loop\n  ],\n})`,
    );
  });

  it("creates the parents with createManyAndReturn, then their nested records with createMany", async () => {
    const profile = await profiled(async () => {
      for (const n of [6, 7, 8, 9, 10])
        await prisma.user.create({
          data: {
            email: `u${n}@example.test`,
            orders: { create: [{ total: n, status: "paid" }] },
          },
        });
    });
    const fix = fixOf(profile);
    expect(fix.options[0]).toMatchObject({
      short: "createMany",
      queries: 2,
      instead: 25,
    });
    expect(code(fix)).toContain("const created = await prisma.user.createManyAndReturn({");
    expect(code(fix)).toContain(`{ userId: created[0].id, total: 6, status: "paid" },`);
    await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
    const runnable = code(fix).replaceAll(/\s*\/\/ … \d+ more, as in the loop/g, "");
    await run(runnable);
    expect(await prisma.order.findMany({ select: { userId: true, total: true } })).toEqual([
      { userId: 1, total: 6 },
      { userId: 2, total: 7 },
    ]);
  });

  it("updates or deletes by one key with updateMany or deleteMany", async () => {
    const updated = fixOf(
      await profiled(async () => {
        for (const id of [1, 3, 5, 7, 9])
          await prisma.order.update({ where: { id }, data: { status: "shipped" } });
      }),
    );
    expect(updated.operation).toBe("Order.update");
    expect(code(updated)).toBe(
      `prisma.order.updateMany({\n  where: { id: { in: [1, 3, 5, 7, 9] } },\n  data: { status: "shipped" },\n})`,
    );
    await run(code(updated));
    expect(await prisma.order.count({ where: { status: "shipped" } })).toBe(5);
    const deleted = fixOf(
      await profiled(async () => {
        for (const id of ids) await prisma.order.delete({ where: { id } });
      }),
    );
    expect(deleted.options[0]).toMatchObject({ short: "deleteMany", queries: 1, instead: 5 });
  });

  it("says no single query does it when each update writes other values, hidden ones too", async () => {
    for (const write of [
      (id: number) => prisma.order.update({ where: { id }, data: { total: id * 10 } }),
      (id: number) => prisma.user.update({ where: { id }, data: { password: "the same?" } }),
    ]) {
      const fix = fixOf(
        await profiled(async () => {
          for (const id of ids) await write(id);
        }),
      );
      expect(fix.options).toEqual([]);
      expect(fix.note).toContain("no single query does that");
    }
  });
});

it("points raw SQL in a loop to one statement with IN", async () => {
  const profile = await profiled(async () => {
    for (const id of ids) await pool.query('SELECT * FROM "Order" WHERE "userId" = $1', [id]);
  });
  expect(fixOf(profile)).toMatchObject({ operation: "raw SQL", times: 5, options: [] });
});

it("serves each N+1's fix by its first query, with the relations of the schema it finds", async () => {
  const profile = await profiled(async () => {
    const users = await prisma.user.findMany();
    for (const user of users) await prisma.order.count({ where: { userId: user.id } });
  });
  const response = await createHandler()(
    new Request(`http://localhost:4983/_profiler/api/profiles/${profile.token}/fixes`),
  );
  const fixes = (await response.json()) as Record<string, N1Fix>;
  const first = profile.warnings.find((warning) => warning.kind === "n+1")!.queryIds[0]!;
  expect(Object.keys(fixes)).toEqual([first]);
  expect(fixes[first]!.options.map((option) => option.short)).toEqual(["include", "groupBy"]);
});
