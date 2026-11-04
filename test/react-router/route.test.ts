import { clearProfiles, endProfile, startProfile } from "../../src/core/index.js";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loader } from "../../src/react-router/route.js";
import { ProfilerToolbar } from "../../src/react-router/toolbar.js";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearProfiles();
});
afterEach(() => vi.unstubAllEnvs());

it("serves the profiler API from a resource route", async () => {
  const profile = endProfile(
    startProfile({ method: "GET", url: "/", kind: "document" }, { name: "test" }),
  );
  const response = await loader({
    request: new Request(`http://localhost/_profiler/api/profiles/${profile.token}`),
  });
  expect(((await response.json()) as { token: string }).token).toBe(profile.token);
});

it("renders the bar's element, with where the API is and which editor to open", () => {
  expect(renderToString(createElement(ProfilerToolbar, { editor: "cursor" }))).toBe(
    '<query-profiler-toolbar data-base="/_profiler" data-editor="cursor"></query-profiler-toolbar>',
  );
});
