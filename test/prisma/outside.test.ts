import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import { clearProfiles, listProfiles, profileOutside } from "../../src/core/index.js";
import type { OutsideRecorder } from "../../src/core/index.js";
import { profilePool, profilePrisma, profileTask, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

const pool = profilePool(new pg.Pool({ connectionString: TEST_DATABASE_URL }));
const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })));

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

let outside: OutsideRecorder | undefined;
beforeEach(async () => {
  await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
  clearProfiles();
});
afterEach(() => outside?.stop());
afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

it("records what a script does through Prisma, with the line of each call", async () => {
  outside = profileOutside({ script: "prisma/seed.ts", framework: { name: "test" } });
  for (const email of ["a@example.test", "b@example.test"])
    await prisma.user.create({ data: { email } }); // seed-call
  await pool.query('SELECT count(*) FROM "User"'); // raw-call
  const profile = outside.close()!;
  expect(profile.operations.map((op) => [op.model, op.action])).toEqual([
    ["User", "create"],
    ["User", "create"],
  ]);
  expect(profile.operations[0]!.origin![0]).toMatchObject({ line: lineOf("// seed-call") });
  const raw = profile.queries.find((query) => query.sql.startsWith("SELECT count"));
  expect(raw!.origin![0]).toMatchObject({ line: lineOf("// raw-call") });
  expect(profile.summary.queryCount).toBeGreaterThanOrEqual(3);
});

it("gives each task its own profile, even when it hands back Prisma's call unawaited", async () => {
  outside = profileOutside({ script: "src/worker.ts", framework: { name: "test" } });
  await prisma.user.count();
  const users = await profileTask("send-emails", () => prisma.user.findMany()); // task-call
  await profileTask("count-orders", async () => prisma.order.count());
  expect(users).toEqual([]);
  const [orders, emails, startup] = listProfiles();
  expect(startup).toMatchObject({ kind: "startup", request: { url: "src/worker.ts" } });
  expect(emails).toMatchObject({ kind: "task", request: { method: "", url: "send-emails" } });
  expect(emails!.operations).toMatchObject([{ model: "User", action: "findMany" }]);
  expect(emails!.operations[0]!.origin![0]).toMatchObject({ line: lineOf("// task-call") });
  expect(orders!.operations).toMatchObject([{ model: "Order", action: "count" }]);
});

it("hands back a failed task's error, and keeps its profile", async () => {
  const failing = profileTask("broken", () =>
    prisma.user.create({ data: { email: null as unknown as string } }),
  );
  await expect(failing).rejects.toThrow();
  expect(listProfiles()[0]).toMatchObject({ kind: "task", summary: { errorCount: 1 } });
});
