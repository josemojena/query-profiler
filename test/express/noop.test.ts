import { execFileSync } from "node:child_process";
import express from "express";
import { expect, it } from "vitest";
import * as middleware from "../../src/express/index.js";
import * as noop from "../../src/express/noop.js";

const resolvedEntry = (...flags: string[]) =>
  execFileSync(
    process.execPath,
    [
      ...flags,
      "--input-type=module",
      "-e",
      'console.log(import.meta.resolve("query-profiler/express"))',
    ],
    { encoding: "utf8" },
  ).trim();

it("offers the same API in every entry, doing nothing, for production", async () => {
  expect(Object.keys(noop)).toEqual(Object.keys(middleware));
  const app = express();
  app.use(noop.profilerMiddleware());
  app.get("/orders", (_request, response) => void response.json([]));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const response = await fetch(`${origin}/orders`);
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Debug-Token")).toBeNull();
  expect((await fetch(`${origin}/_profiler`)).status).toBe(404);
  await new Promise((resolve) => server.close(resolve));
});

it("loads the real middleware only when Node runs with --conditions=development", () => {
  expect(resolvedEntry()).toMatch(/\/dist\/express\/noop\.js$/);
  expect(resolvedEntry("--conditions=development")).toMatch(/\/dist\/express\/index\.js$/);
});
