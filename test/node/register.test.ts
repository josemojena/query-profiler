import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const ROOT = new URL("../..", import.meta.url).pathname;
const PRELOAD = ["--import", "query-profiler/register"];

// An app that knows nothing of the profiler: it answers, and closes its server when told to.
const APP = `
import { createServer } from "node:http";
const server = createServer((_request, response) => response.end("ok"));
server.listen(0, "127.0.0.1", () => process.send(server.address().port));
process.on("message", () => server.close(() => process.disconnect()));
`;

// A process that never serves anything, as a CLI that only launches the app.
const LAUNCHER = `setTimeout(() => process.disconnect(), 200);`;

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

function script(code: string) {
  const file = join(
    mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-register-")),
    "app.mjs",
  );
  writeFileSync(file, code);
  return file;
}

/** Node running `code` from the repository, as an app's dev command would, with these flags. */
function run(code: string, flags: string[], env: Record<string, string> = {}) {
  const child = fork(script(code), {
    cwd: ROOT,
    execArgv: flags,
    // Without the NODE_PATH pnpm gives the test runner; port 0 keeps parallel runs apart.
    env: { PATH: process.env.PATH, NODE_PATH: "", QUERY_PROFILER_PORT: "0", ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  let output = "";
  let notices = "";
  child.stdout!.on("data", (chunk: Buffer) => (output += chunk));
  child.stderr!.on("data", (chunk: Buffer) => (notices += chunk));
  const port = new Promise<number>((resolve) => child.once("message", (m) => resolve(m as number)));
  const exit = new Promise<number | null>((resolve) => child.once("exit", resolve));
  return { child, output: () => output, notices: () => notices, port, exit };
}

const profilerUrl = (output: () => string) =>
  vi.waitFor(() => {
    const url = /\[query-profiler\] (http:\/\/localhost:\d+\/_profiler)/.exec(output())?.[1];
    expect(url).toBeDefined();
    return url!;
  });

it("profiles the app's requests and serves the profiler on its own port, once the app listens", async () => {
  const app = run(APP, PRELOAD);
  const response = await fetch(`http://127.0.0.1:${await app.port}/users`);
  const token = response.headers.get("X-Debug-Token");
  expect(token).toMatch(/^[0-9a-f]{6}$/);
  const url = await profilerUrl(app.output);
  expect((await fetch(url)).status).toBe(200);
  const profiles = (await (await fetch(`${url}/api/profiles`)).json()) as { token: string }[];
  expect(profiles.map((profile) => profile.token)).toEqual([token]);
  expect(app.output()).not.toContain("GET /users");
});

it("says where it listens when QUERY_PROFILER_HOST is set", async () => {
  const app = run(APP, PRELOAD, { QUERY_PROFILER_HOST: "0.0.0.0" });
  await app.port;
  await profilerUrl(app.output);
  expect(app.output()).toMatch(/\/_profiler \(listening on 0\.0\.0\.0\)/);
});

it("lets the app's process end once the app closes its server", async () => {
  const app = run(APP, PRELOAD);
  await app.port;
  await profilerUrl(app.output);
  app.child.send("close");
  expect(await app.exit).toBe(0);
});

it("opens no port in a process that never serves, as a CLI that launches the app", async () => {
  const launcher = run(LAUNCHER, PRELOAD);
  expect(await launcher.exit).toBe(0);
  expect(launcher.output()).toBe("");
});

it("prints a line per request with QUERY_PROFILER_LOG=1", async () => {
  const app = run(APP, PRELOAD, { QUERY_PROFILER_LOG: "1" });
  await fetch(`http://127.0.0.1:${await app.port}/users`);
  await vi.waitFor(() => expect(app.output()).toMatch(/GET \/users .*200/));
});

/** Runs the app with these flags, calls it once, and lets it close. */
async function callOnce(flags: readonly string[], env: Record<string, string> = {}) {
  const app = run(APP, [...flags], env);
  const response = await fetch(`http://127.0.0.1:${await app.port}/users`);
  app.child.send("close");
  expect(await app.exit).toBe(0);
  return {
    token: response.headers.get("X-Debug-Token"),
    output: app.output(),
    notices: app.notices(),
  };
}

it("says why it is off when NODE_ENV is neither development nor unset", async () => {
  const result = await callOnce(PRELOAD, { NODE_ENV: "local" });
  expect(result.token).toBeNull();
  expect(result.notices).toContain('Off: NODE_ENV is "local"');
});

it("stays silent in production and in test runs, where being off is the point", async () => {
  for (const [flags, env] of [
    [PRELOAD, { NODE_ENV: "production" }],
    [PRELOAD, { NODE_ENV: "test" }],
    [PRELOAD, { QUERY_PROFILER_DISABLED: "1" }],
  ] as const) {
    expect(await callOnce(flags, env)).toEqual({ token: null, output: "", notices: "" });
  }
});

// An app's own import of the profiler, by import and by require, saying which code it got.
const PRISMA_ENTRY = {
  "esm.mjs": `const { withProfiler } = await import("query-profiler/prisma");
console.log("comments" in withProfiler({ adapter: {} }) ? "real" : "empty");`,
  "cjs.cjs": `const { withProfiler } = require("query-profiler/prisma");
console.log("comments" in withProfiler({ adapter: {} }) ? "real" : "empty");`,
};

/** An app folder with the package installed, as npm would, through a link to this repository. */
function appWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-app-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "query-profiler"), "dir");
  for (const [name, code] of Object.entries(files)) writeFileSync(join(dir, name), code);
  return dir;
}

const entryIn = (dir: string, file: string, flags: string[], env: Record<string, string> = {}) =>
  execFileSync(process.execPath, [...flags, file], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_PATH: "", ...env },
    encoding: "utf8",
  }).trim();

it("gives the app's own imports of the profiler its real code, by import and require, with no other flag", () => {
  const dir = appWith(PRISMA_ENTRY);
  expect(entryIn(dir, "esm.mjs", PRELOAD)).toBe("real");
  expect(entryIn(dir, "cjs.cjs", PRELOAD)).toBe("real");
});

it("leaves those imports empty without the preload, and in production even with it", () => {
  const dir = appWith(PRISMA_ENTRY);
  expect(entryIn(dir, "esm.mjs", [])).toBe("empty");
  expect(entryIn(dir, "cjs.cjs", [])).toBe("empty");
  expect(entryIn(dir, "esm.mjs", PRELOAD, { NODE_ENV: "production" })).toBe("empty");
  expect(entryIn(dir, "cjs.cjs", PRELOAD, { NODE_ENV: "production" })).toBe("empty");
});
