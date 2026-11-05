import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import express from "express";
import type { Server } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfiles, listProfiles } from "../../src/core/index.js";
import { profilerMiddleware } from "../../src/express/index.js";
import { profilePool, profilePrisma, withProfiler } from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";
import { PrismaClient } from "./fixture/generated/client.js";

const pool = profilePool(new pg.Pool({ connectionString: TEST_DATABASE_URL }));
const prisma = profilePrisma(new PrismaClient(withProfiler({ adapter: new PrismaPg(pool) })));

const source = readFileSync(import.meta.filename, "utf8").split("\n");
const lineOf = (snippet: string) => source.findIndex((line) => line.includes(snippet)) + 1;

let server: Server;

/** The profiles stored once the response has closed. */
const stored = () =>
  vi.waitFor(() => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    return profiles;
  });
let origin = "";

beforeAll(async () => {
  const app = express();
  app.use(profilerMiddleware());
  app.use(express.json());
  app.get("/users", async (_request, response) => {
    const users = await prisma.user.findMany(); // users-call
    response.json(
      await Promise.all(
        users.map(async (user) => ({
          ...user,
          orders: await prisma.order.count({ where: { userId: user.id } }), // count-call
        })),
      ),
    );
  });
  app.post("/users", async (request, response) => {
    const body = request.body as { email: string };
    response.json(await prisma.user.create({ data: { email: body.email } })); // create-call
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  clearProfiles();
  await pool.query('TRUNCATE "Order", "User" RESTART IDENTITY CASCADE');
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
  await pool.end();
});

describe("Prisma inside an Express app", () => {
  it("records each operation of a route with its SQL and the line that called it, and warns of the N+1", async () => {
    for (let n = 1; n <= 5; n++)
      await prisma.user.create({ data: { email: `u${n}@example.test` } });
    clearProfiles();
    const response = await fetch(`${origin}/users`);
    expect(response.status).toBe(200);
    const [profile] = await stored();
    expect(response.headers.get("X-Debug-Token")).toBe(profile!.token);
    const [findMany, ...counts] = profile!.operations;
    expect(findMany).toMatchObject({ model: "User", action: "findMany" });
    expect(findMany!.origin![0]).toMatchObject({ line: lineOf("// users-call") });
    expect(counts).toHaveLength(5);
    expect(counts[0]!.origin![0]).toMatchObject({ line: lineOf("// count-call") });
    for (const op of profile!.operations) expect(op.queryIds).toHaveLength(1);
    expect(profile!.warnings.map((warning) => warning.kind)).toContain("n+1");
  });

  it("records what a route does with the body it was sent", async () => {
    const response = await fetch(`${origin}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.test" }),
    });
    expect(response.status).toBe(200);
    const [profile] = await stored();
    expect(profile!.request).toMatchObject({ method: "POST", url: "/users", route: "/users" });
    expect(profile!.operations[0]).toMatchObject({ model: "User", action: "create" });
    expect(profile!.operations[0]!.origin![0]).toMatchObject({ line: lineOf("// create-call") });
    expect(profile!.queries.some((query) => query.sql.startsWith("INSERT"))).toBe(true);
  });
});
