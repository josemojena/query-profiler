import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import express from "express";
import { beginQuery, clearProfiles, currentScope } from "../src/core/index.js";
import { profilerMiddleware } from "../src/express/index.js";

let server: Server;
let origin = "";

test.beforeAll(async () => {
  process.env.NODE_ENV = "development";
  clearProfiles();
  const app = express();
  app.use(profilerMiddleware());
  app.get("/users", (_request, response) => {
    const scope = currentScope();
    for (let id = 1; id <= 5; id++)
      if (scope)
        beginQuery(scope.profile, { sql: `SELECT "id" FROM "Post" WHERE "authorId" = ${id}` });
    response.json([]);
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

test("serves the profiler page from an Express app, with no Vite, and shows its requests", async ({
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
