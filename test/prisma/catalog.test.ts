import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCatalog } from "../../src/analysis/catalog.js";
import { engineOf } from "../../src/analysis/explain.js";
import {
  endProfile,
  findDatabase,
  runWithProfile,
  startProfile,
  type Database,
} from "../../src/core/index.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { ENGINES } from "./engines.js";

describe.each(ENGINES)("%s", (engine, connect) => {
  const prisma = profilePrisma(connect());
  let database: Database;

  beforeAll(async () => {
    const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
    await runWithProfile(active, async () => {
      await prisma.user.count();
    });
    database = findDatabase(endProfile(active, { status: 200 }).queries[0]!.database)!;
    expect((await engineOf(database)).engine).toBe(engine);
  });
  afterAll(() => prisma.$disconnect());

  const catalog = () =>
    readCatalog(database.run, engine, [{ name: "Order" }, { name: "User" }, { name: "Nope" }]);

  it("lists each table's indexes with their columns in order, and leaves out a table it does not have", async () => {
    const [order, user] = await catalog();
    expect([order!.name, user!.name]).toEqual(["Order", "User"]);
    const unique = (table: typeof user) =>
      table!.indexes.filter((index) => index.unique).map((index) => index.columns);
    expect(unique(user)).toEqual(expect.arrayContaining([["id"], ["email"]]));
    expect(user!.indexes.find((index) => index.primary)!.columns).toEqual(["id"]);
  });

  it("gives a foreign key its own index on InnoDB only", async () => {
    const [order] = await catalog();
    const onUserId = order!.indexes.some((index) => index.columns[0] === "userId");
    expect(onUserId).toBe(engine === "mysql" || engine === "mariadb");
  });

  it("lists each foreign key with its columns and what they reference", async () => {
    const [order] = await catalog();
    expect(order!.foreignKeys).toMatchObject([
      { columns: ["userId"], references: { table: "User" } },
    ]);
    if (engine !== "sqlite") expect(order!.foreignKeys[0]!.references.columns).toEqual(["id"]);
  });

  it("lists the columns with their type and whether they take NULL", async () => {
    const [, user] = await catalog();
    expect(user!.columns.map((column) => column.name)).toEqual(["id", "email", "password"]);
    expect(user!.columns.find((column) => column.name === "password")!.nullable).toBe(true);
    expect(user!.columns.find((column) => column.name === "email")!.nullable).toBe(false);
  });

  it.runIf(engine === "postgres" || engine === "sqlite")(
    "sees an expression index and a partial one, created in a transaction that is rolled back",
    async () => {
      const table = engine === "postgres" ? '"User"' : "`User`";
      const indexes = await database.rolledBack(async (run) => {
        await run(`CREATE INDEX qp_email_lower ON ${table} (lower(email)) WHERE password IS NULL`);
        const [user] = await readCatalog(run, engine, [{ name: "User" }]);
        return user!.indexes;
      });
      expect(indexes.find((index) => index.name === "qp_email_lower")).toMatchObject({
        expression: true,
        unique: false,
        where: expect.stringMatching(/password IS NULL/i),
      });
      const [user] = await catalog();
      expect(user!.indexes.some((index) => index.name === "qp_email_lower")).toBe(false);
    },
  );

  it.runIf(engine === "postgres" || engine === "sqlite")(
    "keeps each key part's direction and operator class, so (email) and (email DESC) differ",
    async () => {
      const table = engine === "postgres" ? '"User"' : "`User`";
      const other = engine === "postgres" ? "email text_pattern_ops" : "email DESC";
      const indexes = await database.rolledBack(async (run) => {
        await run(`CREATE INDEX qp_email_other ON ${table} (${other})`);
        const [user] = await readCatalog(run, engine, [{ name: "User" }]);
        return user!.indexes;
      });
      expect(indexes.find((index) => index.name === "User_email_key")!.parts).toEqual(["email"]);
      expect(indexes.find((index) => index.name === "qp_email_other")).toMatchObject({
        columns: ["email"],
        parts: [other],
      });
    },
  );

  it.runIf(engine === "postgres")(
    "tells a table never analyzed from one with statistics",
    async () => {
      const analyzed = await database.rolledBack(async (run) => {
        await run("CREATE TABLE qp_fresh (id int)");
        await run("INSERT INTO qp_fresh SELECT generate_series(1, 10)");
        const [before] = await readCatalog(run, engine, [{ name: "qp_fresh" }]);
        await run("ANALYZE qp_fresh");
        const [after] = await readCatalog(run, engine, [{ name: "qp_fresh" }]);
        return [before!.analyzed, after!.analyzed];
      });
      expect(analyzed).toEqual([false, true]);
    },
  );
});
