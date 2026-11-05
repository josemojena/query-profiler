import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runWithProfile, startProfile } from "../../src/core/index.js";
import { ProfilerToolbar } from "../../src/next/index.js";

beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
afterEach(() => vi.unstubAllEnvs());

it("renders the script that brings the bar, with the token of the page's request", () => {
  const active = startProfile({ method: "GET", url: "/", kind: "document" }, { name: "next" });
  const html = runWithProfile(active, () =>
    renderToStaticMarkup(createElement(ProfilerToolbar, { base: "/_debug" })),
  );
  expect(html).toMatch(/^<script>/);
  expect(html).toContain(`"token":"${active.profile.token}"`);
  expect(html).toContain('"base":"/_debug"');
  expect(html).toContain("query-profiler-toolbar");
  expect(html).not.toContain("currentScript.remove");
});

it("renders nothing outside a profiled request", () => {
  expect(renderToStaticMarkup(createElement(ProfilerToolbar))).toBe("");
});
