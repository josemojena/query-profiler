import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterEach, expect, it, vi } from "vitest";
import {
  profileAdapter,
  profilePool,
  profilePrisma,
  stampPlugin,
  withProfiler,
} from "../../src/prisma/index.js";
import { TEST_DATABASE_URL } from "./database.js";

afterEach(() => vi.unstubAllEnvs());

const adapter = () => new PrismaPg({ connectionString: TEST_DATABASE_URL });

it("leaves the client, its options and the pool untouched in production and test runs, even with the real code loaded", async () => {
  for (const environment of ["production", "test"]) {
    vi.stubEnv("NODE_ENV", environment);
    const options = { adapter: adapter() };
    expect(withProfiler(options)).toBe(options);
    expect(profileAdapter(options.adapter)).toBe(options.adapter);
    const client = {
      $extends: () => {
        throw new Error("the client was extended");
      },
    };
    expect(profilePrisma(client)).toBe(client);
    const pool = new pg.Pool();
    expect(profilePool(pool)).toBe(pool);
    expect(Object.hasOwn(pool, "query")).toBe(false);
    expect(pool.listenerCount("connect")).toBe(0);
    await pool.end();
  }
});

it("wraps them in development, adding the stamp to every statement's comments", () => {
  vi.stubEnv("NODE_ENV", "development");
  const options = { adapter: adapter() };
  const profiled = withProfiler(options) as typeof options & { comments: unknown[] };
  expect(profiled).not.toBe(options);
  expect(profiled.comments).toEqual([stampPlugin]);
});
