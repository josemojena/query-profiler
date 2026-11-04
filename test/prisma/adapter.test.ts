import { endProfile, runWithProfile, startProfile, type Profile } from "../../src/core/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, expect, it } from "vitest";
import { profilerExtension, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

// Only Prisma is profiled: its statements arrive through the adapter, nothing patches the pool.
const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const prisma = new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })).$extends(
  profilerExtension,
);
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

async function profiled(fn: () => Promise<unknown>): Promise<Profile> {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" });
  await runWithProfile(active, async () => {
    await fn();
  });
  return endProfile(active, { status: 200 });
}

it("gets every Prisma statement from the adapter, with its operation", async () => {
  const profile = await profiled(async () => {
    await prisma.user.findMany();
    await pool.query("SELECT 'raw, not profiled'");
  });
  expect(profile.queries).toHaveLength(1);
  expect(profile.queries[0]!.opId).toBe(profile.operations[0]!.id);
});

it("records a transaction's BEGIN, which the adapter runs itself, once", async () => {
  const profile = await profiled(() => prisma.$transaction(async (tx) => tx.user.count()));
  expect(profile.queries.map((q) => q.sql.split(" ")[0])).toEqual(["BEGIN", "SELECT", "COMMIT"]);
  expect(profile.queries[0]!.durationMs).toBeGreaterThan(0);
});
