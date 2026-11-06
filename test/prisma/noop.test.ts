import { expect, it } from "vitest";
import * as noop from "../../src/prisma/noop.js";
import * as real from "../../src/prisma/index.js";

it("offers the same API, doing nothing, for production builds", async () => {
  expect(Object.keys(noop).sort()).toEqual(Object.keys(real).sort());
  const options = { adapter: { connect: async () => ({}) } };
  expect(noop.withProfiler(options)).toBe(options);
  expect(noop.profilePool(options)).toBe(options);
  expect(noop.profilePrisma(options)).toBe(options);
  expect(noop.profileAdapter(options.adapter)).toBe(options.adapter);
  expect(noop.profilerExtension).toEqual({ name: "query-profiler" });
  expect(await noop.profileTask("send-emails", () => 3)).toBe(3);
});
