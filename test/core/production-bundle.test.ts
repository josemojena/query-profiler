import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it, vi } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;

// An app written as the docs say: Prisma profiled with plain static imports, the server untouched.
const PRISMA = `
import { profilePrisma, withProfiler } from "query-profiler/prisma";

const fakeAdapter = { connect: async () => ({}) };
const fakeClient = (options) => ({ options, $extends: () => fakeClient(options) });
const prisma = profilePrisma(fakeClient(withProfiler({ adapter: fakeAdapter })));
`;
const APPS = {
  express: `
import express from "express";
${PRISMA}
const app = express();
app.get("/users", (_request, response) => void response.json({ stamped: "comments" in prisma.options }));
`,
  fastify: `
import Fastify from "fastify";
${PRISMA}
const app = Fastify();
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

/**
 * Starts the bundle and asks it for /users. In production it runs away from the repository, with
 * no NODE_PATH; in development, from the app's folder with the preload, as its dev command would.
 */
async function call(outfile: string, preload: boolean) {
  const child = fork(outfile, {
    cwd: preload ? ROOT : dirname(outfile),
    execArgv: preload ? ["--conditions=development", "--import", "query-profiler/register"] : [],
    env: { PATH: process.env.PATH, NODE_PATH: "", QUERY_PROFILER_PORT: "0" },
    stdio: ["ignore", "pipe", "inherit", "ipc"],
  });
  let output = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      child.once("message", (message) => resolve(message as number));
      child.once("exit", (code) => reject(new Error(`The bundle exited with ${code}`)));
    });
    const users = await fetch(`http://127.0.0.1:${port}/users`);
    const token = users.headers.get("x-debug-token");
    const body = (await users.json()) as { stamped: boolean };
    if (!preload) return { token, body };
    const url = await vi.waitFor(() => /\[query-profiler\] (\S+)/.exec(output)![1]!);
    return { token, body, profiler: (await fetch(url)).status };
  } finally {
    child.kill();
  }
}

describe.each(["express", "fastify"] as const)("a %s app bundled for production", (name) => {
  it("runs with none of the profiler inside, so the package can be a dev dependency", async () => {
    const outfile = await bundle(name, []);
    const code = readFileSync(outfile, "utf8");
    expect(code).not.toMatch(/AsyncLocalStorage|startProfile|query_profiler/);
    expect(await call(outfile, false)).toEqual({ token: null, body: { stamped: false } });
  });

  it("is profiled when bundled with the development condition and run with the preload", async () => {
    const outfile = await bundle(name, ["development"]);
    const result = await call(outfile, true);
    expect(result.token).toMatch(/^[0-9a-f]{6}$/);
    expect(result.body).toEqual({ stamped: true });
    expect(result.profiler).toBe(200);
  });
});
