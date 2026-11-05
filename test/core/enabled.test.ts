import { afterEach, expect, it, vi } from "vitest";
import { enabled } from "../../src/core/enabled.js";

afterEach(() => vi.unstubAllEnvs());

it("runs in development, and when NODE_ENV is not set, as servers without a bundler leave it", () => {
  vi.stubEnv("NODE_ENV", "development");
  expect(enabled()).toBe(true);
  vi.stubEnv("NODE_ENV", undefined);
  expect(enabled()).toBe(true);
});

it("never runs in production or in test runs", () => {
  for (const environment of ["production", "test", "staging"]) {
    vi.stubEnv("NODE_ENV", environment);
    expect(enabled()).toBe(false);
  }
});

it("stays off when QUERY_PROFILER_DISABLED=1, even in development", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("QUERY_PROFILER_DISABLED", "1");
  expect(enabled()).toBe(false);
});
