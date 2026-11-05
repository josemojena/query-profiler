import { expect, it } from "vitest";
import * as toolbar from "../../src/next/index.js";
import * as toolbarNoop from "../../src/next/noop.js";
import * as route from "../../src/next/route.js";
import * as routeNoop from "../../src/next/route-noop.js";
import * as registerNoop from "../../src/next/register-noop.js";

it("offers the same API in every entry, doing nothing, for production builds", async () => {
  expect(Object.keys(toolbarNoop)).toEqual(Object.keys(toolbar));
  expect(Object.keys(routeNoop).sort()).toEqual(Object.keys(route).sort());
  expect(toolbarNoop.ProfilerToolbar()).toBeNull();
  expect(routeNoop.GET().status).toBe(404);
  expect(routeNoop.DELETE().status).toBe(404);
  expect(Object.keys(registerNoop)).toEqual([]);
});
