import { execFileSync } from "node:child_process";
import Fastify from "fastify";
import { expect, it } from "vitest";
import * as plugin from "../../src/fastify/index.js";
import * as noop from "../../src/fastify/noop.js";

const resolvedEntry = (...flags: string[]) =>
  execFileSync(
    process.execPath,
    [
      ...flags,
      "--input-type=module",
      "-e",
      'console.log(import.meta.resolve("query-profiler/fastify"))',
    ],
    { encoding: "utf8" },
  ).trim();

it("offers the same API in every entry, doing nothing, for production", async () => {
  expect(Object.keys(noop)).toEqual(Object.keys(plugin));
  const server = Fastify();
  await server.register(noop.profilerPlugin);
  server.get("/orders", async () => []);
  const response = await server.inject("/orders");
  expect(response.statusCode).toBe(200);
  expect(response.headers["x-debug-token"]).toBeUndefined();
  expect((await server.inject("/_profiler")).statusCode).toBe(404);
});

it("loads the real plugin only when Node runs with --conditions=development", () => {
  expect(resolvedEntry()).toMatch(/\/dist\/fastify\/noop\.js$/);
  expect(resolvedEntry("--conditions=development")).toMatch(/\/dist\/fastify\/index\.js$/);
});
