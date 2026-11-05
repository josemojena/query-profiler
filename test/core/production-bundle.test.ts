import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

// An app written as the docs say, with plain static imports of the profiler, for each server.
const APPS = {
  express: `
import express from "express";
import { profilerMiddleware } from "query-profiler/express";
import { profilePrisma, withProfiler } from "query-profiler/prisma";

const fakeAdapter = { connect: async () => ({}) };
const fakeClient = (options) => ({ options, $extends: () => fakeClient(options) });
const prisma = profilePrisma(fakeClient(withProfiler({ adapter: fakeAdapter })));

const app = express();
app.use(profilerMiddleware());
app.get("/users", (_request, response) => void response.json({ stamped: "comments" in prisma.options }));
`,
  fastify: `
import Fastify from "fastify";
import { profilerPlugin } from "query-profiler/fastify";
import { profilePrisma, withProfiler } from "query-profiler/prisma";

const fakeAdapter = { connect: async () => ({}) };
const fakeClient = (options) => ({ options, $extends: () => fakeClient(options) });
const prisma = profilePrisma(fakeClient(withProfiler({ adapter: fakeAdapter })));

const app = Fastify();
await app.register(profilerPlugin);
app.get("/users", async () => ({ stamped: "comments" in prisma.options }));
`,
};

const LISTEN = {
  express:
    "const server = app.listen(0, '127.0.0.1', () => process.send?.(server.address().port));",
  fastify:
    "await app.listen({ port: 0, host: '127.0.0.1' }); process.send?.(app.server.address().port);",
};

/** The app bundled whole, every dependency inside, into a folder with no node_modules. */
async function bundle(name: keyof typeof APPS, conditions: string[]) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `query-profiler-${name}-`));
  const entry = join(ROOT, `.bundle-${name}-${conditions.join("") || "production"}.mjs`);
  writeFileSync(entry, APPS[name] + LISTEN[name]);
  const outfile = join(dir, "server.mjs");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    conditions,
    logLevel: "silent",
    banner: {
      // CommonJS dependencies (Express) require Node's modules: give the ES module bundle a require.
      js: "import { createRequire as createBundleRequire } from 'node:module'; const require = createBundleRequire(import.meta.url);",
    },
  });
  rmSync(entry);
  return outfile;
}

/** Starts the bundle away from the repository, with no NODE_PATH, and asks it for /users. */
async function call(outfile: string) {
  const child = fork(outfile, {
    cwd: dirname(outfile),
    execArgv: [],
    env: { PATH: process.env.PATH },
  });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child.once("message", (message) => resolve(message as number));
      child.once("exit", (code) => reject(new Error(`The bundle exited with ${code}`)));
    });
    const users = await fetch(`http://127.0.0.1:${port}/users`);
    const page = await fetch(`http://127.0.0.1:${port}/_profiler`);
    return {
      token: users.headers.get("x-debug-token"),
      body: (await users.json()) as { stamped: boolean },
      profiler: page.status,
    };
  } finally {
    child.kill();
  }
}

describe.each(["express", "fastify"] as const)("a %s app bundled for production", (name) => {
  it("runs with none of the profiler inside, so the package can be a dev dependency", async () => {
    const outfile = await bundle(name, []);
    const code = readFileSync(outfile, "utf8");
    expect(code).not.toMatch(/AsyncLocalStorage|startProfile|query_profiler/);
    expect(await call(outfile)).toEqual({ token: null, body: { stamped: false }, profiler: 404 });
  });

  it("carries the profiler when bundled with the development condition, as a dev build does", async () => {
    const outfile = await bundle(name, ["development"]);
    const result = await call(outfile);
    expect(result.token).toMatch(/^[0-9a-f]{6}$/);
    expect(result.body).toEqual({ stamped: true });
    expect(result.profiler).toBe(200);
  });
});
