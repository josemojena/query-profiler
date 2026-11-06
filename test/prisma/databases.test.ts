import { readFileSync } from "node:fs";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  endProfile,
  findDatabase,
  runWithProfile,
  startProfile,
  type Profile,
} from "../../src/core/index.js";
import { profilePrisma, withProfiler } from "../../src/prisma/index.js";
import { TEST_MARIADB_URL, TEST_MYSQL_URL, TEST_SQLITE_URL } from "./database.js";
import { PrismaClient as MySqlClient } from "./fixture-mysql/generated/client.js";
import { PrismaClient as SqliteClient } from "./fixture-sqlite/generated/client.js";

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

// The mariadb driver speaks to MySQL too; MySQL 8's default login asks for the server's key.
const mariadb = (url: string) =>
  new PrismaMariaDb(`${url.replace(/^mysql:/, "mariadb:")}?allowPublicKeyRetrieval=true`);

// Both generated clients have the same models: one type keeps the tests the same for each database.
const sqlite = () =>
  new SqliteClient(
    withProfiler({ adapter: new PrismaBetterSqlite3({ url: TEST_SQLITE_URL }) }),
  ) as unknown as MySqlClient;

const DATABASES: [string, () => MySqlClient, string][] = [
  ["MySQL", () => new MySqlClient(withProfiler({ adapter: mariadb(TEST_MYSQL_URL) })), "mysql"],
  ["MariaDB", () => new MySqlClient(withProfiler({ adapter: mariadb(TEST_MARIADB_URL) })), "mysql"],
  ["SQLite", sqlite, "sqlite"],
];

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

const firstWords = (profile: Profile) => profile.queries.map((query) => query.sql.split(" ")[0]);

describe.each(DATABASES)("%s through Prisma's adapter", (_name, connect, provider) => {
  const prisma = profilePrisma(connect());
  let userId = 0;

  beforeEach(async () => {
    await prisma.order.deleteMany();
    await prisma.user.deleteMany();
    userId = (await prisma.user.create({ data: { email: "a@example.test" } })).id;
    await prisma.order.create({ data: { userId, total: 10, status: "paid" } });
  });
  afterAll(() => prisma.$disconnect());

  it("records an operation and the SQL it ran, without the stamp, with the line that called it", async () => {
    const profile = await profiled(async () => {
      await prisma.user.findUnique({ where: { email: "a@example.test" } }); // find-call
    });
    expect(profile.operations).toMatchObject([{ model: "User", action: "findUnique" }]);
    expect(profile.operations[0]!.origin?.[0]?.line).toBe(lineOf("// find-call"));
    const [query] = profile.queries;
    expect(query).toMatchObject({ opId: profile.operations[0]!.id });
    expect(query!.sql).toMatch(/^SELECT /);
    expect(query!.sql).not.toContain("query_profiler");
    expect(query!.params).toContain("a@example.test");
  });

  it("gives a statement Prisma compacted from several findUnique to all of them", async () => {
    const profile = await profiled(() =>
      Promise.all([0, 1, 2].map((n) => prisma.user.findUnique({ where: { id: userId + n } }))),
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
      prisma.$transaction([prisma.user.findMany(), prisma.order.count()]),
    );
    const [findMany, count] = profile.operations;
    const own = (opId: string) => profile.queries.filter((query) => query.opId === opId);
    expect(own(findMany!.id).map((query) => query.sql)).toEqual([expect.stringMatching(/User/)]);
    expect(own(count!.id).map((query) => query.sql)).toEqual([expect.stringMatching(/Order/)]);
  });

  it("in an interactive transaction, records BEGIN and COMMIT once, each statement with its operation", async () => {
    const profile = await profiled(() =>
      prisma.$transaction(async (tx) => {
        await tx.user.findMany();
        await tx.order.create({ data: { userId, total: 5, status: "new" } });
      }),
    );
    const words = firstWords(profile);
    expect(words[0]).toBe("BEGIN");
    expect(words.at(-1)).toBe("COMMIT");
    expect(words.filter((word) => word === "BEGIN" || word === "COMMIT")).toHaveLength(2);
    const transaction = profile.queries[0]!.txId;
    expect(transaction).toBeDefined();
    expect(profile.queries.every((query) => query.txId === transaction)).toBe(true);
    const [findMany, create] = profile.operations;
    expect(profile.queries.some((query) => query.opId === findMany!.id)).toBe(true);
    expect(profile.queries.some((query) => query.opId === create!.id)).toBe(true);
  });

  it("hides secrets in the SQL parameters, by the value passed and by the column written", async () => {
    const created = await profiled(() =>
      prisma.user.create({ data: { email: "b@example.test", password: "hunter2" } }),
    );
    const insert = created.queries.find((query) => query.sql.startsWith("INSERT"))!;
    expect(insert.params).toContain("b@example.test");
    expect(insert.params).toContain("[redacted]");
    expect(insert.params).not.toContain("hunter2");
    const raw = await profiled(
      () => prisma.$queryRaw`SELECT id FROM User WHERE password = ${"swordfish"} AND id > ${0}`,
    );
    expect(raw.queries[0]!.params).toEqual(["[redacted]", 0]);
  });

  it("keeps the error of a failed operation and of its statement", async () => {
    const profile = await profiled(() => prisma.user.create({ data: { email: "a@example.test" } }));
    expect(profile.operations[0]!.error).toBeDefined();
    expect(profile.queries.find((query) => query.error)?.error?.message).toBeTruthy();
    expect(profile.summary.errorCount).toBeGreaterThan(0);
  });

  it("flags one query per user as an N+1", async () => {
    await prisma.user.createMany({
      data: [2, 3, 4, 5, 6].map((n) => ({ email: `u${n}@example.test` })),
    });
    const profile = await profiled(async () => {
      for (const user of await prisma.user.findMany())
        await prisma.order.count({ where: { userId: user.id } });
    });
    expect(profile.warnings).toMatchObject([{ kind: "n+1" }]);
  });

  it("links each statement to its connection, which the profiler can ask without recording it", async () => {
    const [query] = (await profiled(() => prisma.user.findMany())).queries;
    expect(query!.database).toEqual({ id: expect.stringMatching(/#\d+$/), provider });
    const database = findDatabase(query!.database)!;
    const asked = await profiled(async () => {
      expect((await database.run("SELECT ? AS n", [7])).rows).toEqual([[7]]);
    });
    expect(asked.queries).toEqual([]);
  });

  it("undoes everything done in a rolled back transaction", async () => {
    const [query] = (await profiled(() => prisma.user.findMany())).queries;
    await findDatabase(query!.database)!.rolledBack(async (run) => {
      await run("INSERT INTO `User` (email) VALUES (?)", ["b@example.test"]);
      const { rows } = await run("SELECT COUNT(*) FROM `User`");
      expect(Number(rows[0]![0])).toBe(2);
    });
    expect(await prisma.user.count()).toBe(1);
  });
});
