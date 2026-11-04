import { expect, it } from "vitest";
import * as middleware from "../../src/react-router/index.js";
import * as middlewareNoop from "../../src/react-router/noop.js";
import * as route from "../../src/react-router/route.js";
import * as routeNoop from "../../src/react-router/route-noop.js";
import * as toolbar from "../../src/react-router/toolbar.js";
import * as toolbarNoop from "../../src/react-router/toolbar-noop.js";

it("offers the same API in every entry, doing nothing, for production builds", async () => {
  expect(Object.keys(middlewareNoop).sort()).toEqual(Object.keys(middleware).sort());
  expect(Object.keys(routeNoop).sort()).toEqual(Object.keys(route).sort());
  expect(Object.keys(toolbarNoop)).toEqual(Object.keys(toolbar));
  const response = new Response("page");
  expect(await middlewareNoop.profilerMiddleware()({} as never, async () => response)).toBe(
    response,
  );
  expect(routeNoop.loader().status).toBe(404);
  expect(toolbarNoop.ProfilerToolbar()).toBeNull();
});
