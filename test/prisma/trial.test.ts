import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { analyzeQuery, tryIndex } from "../../src/analysis/analyze.js";
import { endProfile, findDatabase, runWithProfile, startProfile } from "../../src/core/index.js";
import { profilePrisma } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { ENGINES } from "./engines.js";

const [, connect] = ENGINES.find(([engine]) => engine === "postgres")!;
const prisma = profilePrisma(connect());
const older = new pg.Client({ connectionString: TEST_DATABASE_URL });

beforeAll(async () => {
  await older.connect();
  for (const sql of [
    "DROP TABLE IF EXISTS qp_hot",
    // Room on each page, so an update keeps the new version of a row next to the old one.
    "CREATE TABLE qp_hot (id INTEGER PRIMARY KEY, v INTEGER NOT NULL) WITH (fillfactor = 50)",
    "INSERT INTO qp_hot SELECT g, g FROM generate_series(1, 20000) g",
    "ANALYZE qp_hot",
  ])
    await prisma.$executeRawUnsafe(sql);
}, 60_000);
afterAll(async () => {
  await older.end();
  await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS qp_hot");
  await prisma.$disconnect();
});

async function suggested() {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await prisma.$queryRawUnsafe("SELECT id FROM qp_hot WHERE v = $1", 5);
  });
  const [query] = endProfile(active, { status: 200 }).queries;
  const database = findDatabase(query!.database)!;
  const fix = (await analyzeQuery(database, query!)).findings.find((each) => each.fix?.index)!.fix!;
  return () => tryIndex(database, query!, { name: fix.index!, sql: fix.sql! });
}

it("says it cannot tell when PostgreSQL keeps the new index from the transaction that built it", async () => {
  const trial = await suggested();
  expect(await trial()).toMatchObject({ used: true });
  // Another transaction still sees the rows as they were before the update.
  await older.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await older.query("SELECT count(*) FROM qp_hot");
  await prisma.$executeRawUnsafe("UPDATE qp_hot SET v = v + 100000 WHERE id <= 2000");
  const blocked = await trial();
  await older.query("COMMIT");
  expect(blocked).toMatchObject({
    used: false,
    inconclusive: expect.stringContaining("so this trial cannot tell"),
  });
});
