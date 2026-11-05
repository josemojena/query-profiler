import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import express from "express";
import Fastify from "fastify";
import { beginQuery, clearProfiles, currentScope } from "../src/core/index.js";
import { profileRequests } from "../src/node/requests.js";
import { profilerServer } from "../src/node/server.js";

/** What a route with an N+1 records: one query per author. */
function fivePostQueries() {
  const scope = currentScope();
  for (let id = 1; id <= 5; id++)
    if (scope)
      beginQuery(scope.profile, { sql: `SELECT "id" FROM "Post" WHERE "authorId" = ${id}` });
  return [];
}

const APPS = {
  async Express() {
    const app = express();
    app.get("/users", (_request, response) => void response.json(fivePostQueries()));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, close: () => new Promise((resolve) => server.close(resolve)) };
  },
  async Fastify() {
    const app = Fastify();
    app.get("/users", async () => fivePostQueries());
    await app.listen({ port: 0, host: "127.0.0.1" });
    return { server: app.server, close: () => app.close() };
  },
};

for (const [name, start] of Object.entries(APPS)) {
  test.describe(name, () => {
    let app: { server: Server; close: () => Promise<unknown> };
    let profiler: Server;
    let origin = "";
    let profilerUrl = "";
    let stop = () => {};

    test.beforeAll(async () => {
      process.env.NODE_ENV = "development";
      clearProfiles();
      profilerUrl = await new Promise<string>((resolve) => {
        profiler = profilerServer({ port: 0, onListening: resolve });
      });
      stop = profileRequests({ skip: (server) => server === profiler });
      app = await start();
      origin = `http://localhost:${(app.server.address() as AddressInfo).port}`;
    });
    test.afterAll(async () => {
      stop();
      await app.close();
      await new Promise((resolve) => profiler.close(resolve));
    });

    test(`shows a ${name} app's requests on the profiler's own port, live`, async ({ page }) => {
      await fetch(`${origin}/users`);
      await page.goto(profilerUrl);
      const view = page.locator("query-profiler-page");
      await expect(view.locator("h1")).toContainText("GET /users");
      await expect(view.locator(".tab.on")).toHaveText("Queries (5)");
      await expect(view).toContainText("N+1 ×5");
      await fetch(`${origin}/users?page=2`);
      await expect(view.locator(".item", { hasText: "/users?page=2" })).toBeVisible();
    });
  });
}

test.describe("Clear", () => {
  let profiler: Server;
  let app: Server;
  let profilerUrl = "";
  let origin = "";
  let stop = () => {};

  test.beforeAll(async () => {
    process.env.NODE_ENV = "development";
    profilerUrl = await new Promise<string>((resolve) => {
      profiler = profilerServer({ port: 0, onListening: resolve });
    });
    stop = profileRequests({ skip: (server) => server === profiler });
    app = createServer((_request, response) => response.end("ok"));
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    origin = `http://localhost:${(app.address() as AddressInfo).port}`;
  });
  test.afterAll(async () => {
    stop();
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => profiler.close(resolve));
  });

  test("empties the profiler in every tab that has it open", async ({ context }) => {
    clearProfiles();
    await fetch(`${origin}/orders`);
    const tabs = [await context.newPage(), await context.newPage()];
    for (const tab of tabs) {
      await tab.goto(profilerUrl);
      await expect(tab.locator("query-profiler-page .item")).toHaveCount(1);
    }
    await tabs[0]!.locator("query-profiler-page").getByRole("button", { name: "Clear" }).click();
    for (const tab of tabs) await expect(tab.locator("query-profiler-page .item")).toHaveCount(0);
  });
});
