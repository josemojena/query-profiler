import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import Fastify, { type FastifyInstance } from "fastify";
import { beginQuery, clearProfiles, currentScope } from "../src/core/index.js";
import { profilerPlugin } from "../src/fastify/index.js";

let server: FastifyInstance;
let origin = "";

test.beforeAll(async () => {
  process.env.NODE_ENV = "development";
  clearProfiles();
  server = Fastify();
  await server.register(profilerPlugin);
  server.get("/users", async () => {
    const scope = currentScope();
    for (let id = 1; id <= 5; id++)
      if (scope)
        beginQuery(scope.profile, { sql: `SELECT "id" FROM "Post" WHERE "authorId" = ${id}` });
    return [];
  });
  await server.listen({ port: 0, host: "127.0.0.1" });
  origin = `http://localhost:${(server.server.address() as AddressInfo).port}`;
});
test.afterAll(() => server.close());

test("serves the profiler page from a Fastify app, with no Vite, and shows its requests", async ({
  page,
}) => {
  await fetch(`${origin}/users`);
  await page.goto(`${origin}/_profiler`);
  const app = page.locator("query-profiler-page");
  await expect(app.locator("h1")).toContainText("GET /users");
  await expect(app.locator(".tab.on")).toHaveText("Queries (5)");
  await expect(app).toContainText("N+1 ×5");
  await fetch(`${origin}/users?page=2`);
  await expect(app.locator(".item", { hasText: "/users?page=2" })).toBeVisible();
});
