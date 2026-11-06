import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { explain, type NoPlan } from "../../src/analysis/explain.js";
import { allSteps, type Plan } from "../../src/analysis/plan.js";
import {
  endProfile,
  findDatabase,
  isTransactionControl,
  runWithProfile,
  startProfile,
  type QueryRecord,
} from "../../src/core/index.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { ENGINES } from "./engines.js";

async function recorded(fn: () => Promise<unknown>): Promise<QueryRecord[]> {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await fn();
  });
  return endProfile(active, { status: 200 }).queries;
}

const planOf = (query: QueryRecord, options?: { measure?: boolean }) =>
  explain(findDatabase(query.database)!, query, options);

function isPlan(result: Plan | NoPlan): asserts result is Plan {
  expect(result).not.toHaveProperty("problem");
}

describe.each(ENGINES)("%s", (engine, connect) => {
  const prisma = profilePrisma(connect());
  let userId = 0;

  beforeEach(async () => {
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    userId = (await prisma.user.create({ data: { email: "a@example.test" } })).id;
    await prisma.order.create({ data: { userId, total: 10, status: "paid" } });
  });
  afterAll(() => prisma.$disconnect());

  const ordersOfUser = async () =>
    (await recorded(() => prisma.order.findMany({ where: { userId } })))[0]!;

  it("knows the engine and its version", async () => {
    const plan = await planOf(await ordersOfUser());
    isPlan(plan);
    expect(plan.engine).toBe(engine);
    expect(plan.version).toMatch(/^\d+\.\d+/);
  });

  it("reads the estimated plan into steps: the table, how it is read and through which index", async () => {
    const plan = await planOf(await ordersOfUser());
    isPlan(plan);
    expect(plan.measured).toBe(false);
    const read = allSteps(plan.steps).find((step) => step.kind === "read")!;
    expect(read.relation ?? read.table).toBe("Order");
    // InnoDB gives every foreign key an index; PostgreSQL and SQLite leave that to the schema.
    if (engine === "mysql" || engine === "mariadb")
      expect(read).toMatchObject({ access: "index", index: "Order_userId_fkey" });
    else expect(read.access).toBe("full");
    expect(plan.raw).toContain("Order");
  });

  it.skipIf(engine === "sqlite")(
    "measures a read by running it in a transaction that is rolled back",
    async () => {
      const plan = await planOf(await ordersOfUser(), { measure: true });
      isPlan(plan);
      expect(plan.measured).toBe(true);
      const read = allSteps(plan.steps).find((step) => step.kind === "read")!;
      expect(read.measured).toMatchObject({ rows: 1, loops: 1 });
    },
  );

  it.runIf(engine === "sqlite")("says SQLite never measures a plan", async () => {
    expect(await planOf(await ordersOfUser(), { measure: true })).toMatchObject({
      problem: "not_measurable",
    });
  });

  it("explains a write without running it, and never runs one to measure it", async () => {
    const queries = await recorded(() =>
      prisma.order.updateMany({ where: { userId }, data: { status: "sent" } }),
    );
    const update = queries.find((query) => /^\s*UPDATE/i.test(query.sql))!;
    await prisma.order.updateMany({ data: { status: "paid" } });
    const plan = await planOf(update);
    isPlan(plan);
    expect(allSteps(plan.steps).length).toBeGreaterThan(0);
    expect(await planOf(update, { measure: true })).toMatchObject({ problem: "not_measurable" });
    expect((await prisma.order.findFirst())!.status).toBe("paid");
  });

  it("has no plan for transaction control", async () => {
    const queries = await recorded(() => prisma.$transaction(async (tx) => tx.user.count()));
    const begin = queries.find((query) => isTransactionControl(query.sql))!;
    expect(await planOf(begin)).toMatchObject({ problem: "not_explainable" });
  });

  it("plans a query whose parameter was hidden: without values on PostgreSQL, with a stand-in elsewhere", async () => {
    const [query] = await recorded(() => prisma.user.findFirst({ where: { password: "hunter2" } }));
    expect(query!.params).toContain("[redacted]");
    const plan = await planOf(query!);
    isPlan(plan);
    expect({ generic: plan.generic, approximate: plan.approximate }).toEqual(
      engine === "postgres"
        ? { generic: true, approximate: false }
        : { generic: false, approximate: true },
    );
  });

  it("plans a query whose LIMIT and OFFSET were recorded as text, as Prisma 7.1 sends BigInts there", async () => {
    const [query] = await recorded(() =>
      prisma.user.findFirst({ where: { email: "a@example.test" } }),
    );
    const asText = query!.params.map((param) =>
      typeof param === "number" ? String(param) : param,
    );
    isPlan(await planOf({ ...query!, params: asText }));
  });

  it.runIf(engine === "mysql")(
    "reads the plan in JSON format version 2, MySQL 9.5's default",
    async () => {
      const query = await ordersOfUser();
      const database = findDatabase(query.database)!;
      const plan = await database.rolledBack(async (run) => {
        await run("SET explain_json_format_version = 2");
        try {
          return await explain(database, query, { run });
        } finally {
          await run("SET explain_json_format_version = DEFAULT");
        }
      });
      isPlan(plan);
      expect(plan.raw).toContain('"operation"');
      const read = allSteps(plan.steps).find((step) => step.kind === "read")!;
      expect(read).toMatchObject({
        relation: "Order",
        access: "index",
        index: "Order_userId_fkey",
      });
    },
  );
});
