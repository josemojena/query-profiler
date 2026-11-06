import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
const run = (code: string, flags: string[], env: Record<string, string> = {}) =>
  runFile(script(code), ROOT, flags, env);

function runFile(file: string, cwd: string, flags: string[], env: Record<string, string> = {}) {
  const child = fork(file, {
    cwd,
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

// Node's cluster: a primary and two workers that share the app's port.
const CLUSTER = `
import cluster from "node:cluster";
import { createServer } from "node:http";
if (cluster.isPrimary) {
  let ready = 0;
  for (let i = 0; i < 2; i++)
    cluster.fork().on("message", (port) => ++ready === 2 && process.send(port));
  process.on("message", () => {
    for (const worker of Object.values(cluster.workers)) worker.kill();
    process.disconnect();
  });
} else {
  const server = createServer((_request, response) => response.end(String(cluster.worker.id)));
  server.listen(0, "127.0.0.1", () => process.send(server.address().port));
}
`;

/** A free port, found by listening on port 0 and letting it go. */
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "localhost", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const tokens = async (url: string) =>
  ((await (await fetch(`${url}/api/profiles`)).json()) as { token: string }[]).map(
    (profile) => profile.token,
  );

it("gives a Node cluster one profiler, with every worker's requests", async () => {
  const port = String(await freePort());
  const app = run(CLUSTER, PRELOAD, { QUERY_PROFILER_PORT: port });
  const origin = `http://127.0.0.1:${await app.port}`;
  const answers = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(async () => {
      const response = await fetch(`${origin}/users`);
      return { worker: await response.text(), token: response.headers.get("X-Debug-Token")! };
    }),
  );
  expect(new Set(answers.map((answer) => answer.worker))).toEqual(new Set(["1", "2"]));
  const url = `http://localhost:${port}/_profiler`;
  await vi.waitFor(async () =>
    expect((await tokens(url)).sort()).toEqual(answers.map((answer) => answer.token).sort()),
  );
  app.child.send("close");
  expect(await app.exit).toBe(0);
});

it("lets a second app share the first one's profiler, and take it over when the first one ends", async () => {
  const port = String(await freePort());
  const first = run(APP, PRELOAD, { QUERY_PROFILER_PORT: port });
  await first.port;
  const url = await profilerUrl(first.output);
  const second = run(APP, PRELOAD, { QUERY_PROFILER_PORT: port });
  const origin = `http://127.0.0.1:${await second.port}`;
  await vi.waitFor(() => expect(second.output()).toContain(`${url} (shared with another process)`));
  const before = (await fetch(`${origin}/users`)).headers.get("X-Debug-Token")!;
  await vi.waitFor(async () => expect(await tokens(url)).toContain(before));
  first.child.send("close");
  expect(await first.exit).toBe(0);
  await vi.waitFor(() => expect(second.output()).toContain(`[query-profiler] ${url}\n`));
  const after = (await fetch(`${origin}/users`)).headers.get("X-Debug-Token")!;
  await vi.waitFor(async () => expect(await tokens(url)).toEqual([after, before]));
});

// What Prisma records for six counts in a loop, through the profiler's own API: an N+1.
const SEED = `import { beginOperation, beginQuery, captureOrigin, currentScope, finishOperation, finishQuery } from "query-profiler";
for (let i = 0; i < 6; i++) {
  const { profile } = currentScope();
  const op = beginOperation(profile, { model: "Post", action: "count", origin: captureOrigin() });
  finishQuery(profile, beginQuery(profile, { sql: 'SELECT count(*) FROM "Post" WHERE "userId" = $1', params: [i], opIds: [op.id] }));
  finishOperation(profile, op);
}
`;

/** Runs a file of an app folder from that folder, as `node --import query-profiler/register seed.mjs`. */
function runScript(files: Record<string, string>, file: string, env: Record<string, string> = {}) {
  const dir = appWith(files);
  return runFile(join(dir, file), dir, PRELOAD, env);
}

const profileAt = async (url: string, token: string) =>
  (await (await fetch(`${url}/api/profiles/${token}`)).json()) as {
    kind: string;
    request: { url: string };
    summary: { queryCount: number };
  };

/** An app serving the profiler on a port of its own, for scripts to find. */
async function profilerApp() {
  const port = String(await freePort());
  const app = run(APP, PRELOAD, { QUERY_PROFILER_PORT: port });
  await app.port;
  return { port, url: await profilerUrl(app.output) };
}

it("sums a script's run up in the terminal when it ends, each warning with its line", async () => {
  const seed = runScript({ "seed.mjs": SEED }, "seed.mjs");
  expect(await seed.exit).toBe(0);
  expect(seed.output()).toMatch(
    /^\[query-profiler\] script seed\.mjs · 6 queries · [\d.]+ ms in db · 6 operations · 1 warning · [\d.]+ ms · [0-9a-f]{6}\n {2}N\+1 {8}Post\.count, 6 times {2}seed\.mjs:4\n$/,
  );
});

it("sends a script's run to the profiler an app serves, and says where to see it", async () => {
  const { port, url } = await profilerApp();
  const seed = runScript({ "seed.mjs": SEED }, "seed.mjs", { QUERY_PROFILER_PORT: port });
  expect(await seed.exit).toBe(0);
  const token = new RegExp(`${url}/([0-9a-f]{6})\n$`).exec(seed.output())?.[1];
  expect(await profileAt(url, token!)).toMatchObject({
    kind: "script",
    request: { url: "seed.mjs" },
    summary: { queryCount: 6 },
  });
});

it("sends it too when the script ends with process.exit()", async () => {
  const { port, url } = await profilerApp();
  const seed = runScript({ "seed.mjs": `${SEED}process.exit(3);` }, "seed.mjs", {
    QUERY_PROFILER_PORT: port,
  });
  expect(await seed.exit).toBe(3);
  const token = new RegExp(`${url}/([0-9a-f]{6})\n$`).exec(seed.output())?.[1];
  expect((await profileAt(url, token!)).summary.queryCount).toBe(6);
});

it("shows a script in the profiler while it still runs", async () => {
  const { port, url } = await profilerApp();
  const waiting = `${SEED}process.send("seeded"); process.once("message", () => process.disconnect());`;
  const seed = runScript({ "seed.mjs": waiting }, "seed.mjs", { QUERY_PROFILER_PORT: port });
  await seed.port;
  await vi.waitFor(async () => {
    const [running] = (await (await fetch(`${url}/api/profiles`)).json()) as {
      kind: string;
      summary: { queryCount: number };
    }[];
    expect(running).toMatchObject({ kind: "script", summary: { queryCount: 6 } });
  });
  seed.child.send("finish");
  expect(await seed.exit).toBe(0);
});

it("keeps what a server does before it listens as its startup, apart from its requests", async () => {
  const server = `${SEED}${APP}`;
  const app = runScript({ "server.mjs": server }, "server.mjs");
  const response = await fetch(`http://127.0.0.1:${await app.port}/users`);
  const url = await profilerUrl(app.output);
  const profiles = (await (await fetch(`${url}/api/profiles`)).json()) as {
    token: string;
    kind: string;
    request: { url: string };
  }[];
  expect(profiles.map((profile) => [profile.kind, profile.request.url])).toEqual([
    ["api", "/users"],
    ["startup", "server.mjs"],
  ]);
  expect(profiles[0]!.token).toBe(response.headers.get("X-Debug-Token"));
  expect(app.output()).not.toContain("script");
});

it("says it shares the open profiler when a server that joined it before listening starts to listen", async () => {
  const { port, url } = await profilerApp();
  // Queries before listening, then it waits to be told to listen.
  const server = `${SEED}import { createServer } from "node:http";
process.once("message", () => {
  const server = createServer((_request, response) => response.end("ok"));
  server.listen(0, "127.0.0.1", () => process.send(server.address().port));
});
`;
  const app = runScript({ "server.mjs": server }, "server.mjs", { QUERY_PROFILER_PORT: port });
  const kinds = async () =>
    ((await (await fetch(`${url}/api/profiles`)).json()) as { kind: string }[]).map(
      (profile) => profile.kind,
    );
  await vi.waitFor(async () => expect(await kinds()).toContain("script"));
  app.child.send("listen");
  await app.port;
  await vi.waitFor(() =>
    expect(app.output()).toContain(`[query-profiler] ${url} (shared with another process)`),
  );
  await vi.waitFor(async () => expect(await kinds()).toEqual(["startup"]));
});

it("sends each task a worker runs to the profiler an app serves", async () => {
  const { port, url } = await profilerApp();
  const worker = `import { profileTask } from "query-profiler/prisma";
${SEED.split("\n")[0]}
for (const job of [1, 2])
  await profileTask(\`send-email \${job}\`, async () => {
    const { profile } = currentScope();
    finishQuery(profile, beginQuery(profile, { sql: "SELECT 1" }));
  });
`;
  const run = runScript({ "worker.mjs": worker }, "worker.mjs", { QUERY_PROFILER_PORT: port });
  expect(await run.exit).toBe(0);
  expect(run.output()).toBe("");
  await vi.waitFor(async () => {
    const profiles = (await (await fetch(`${url}/api/profiles`)).json()) as {
      kind: string;
      request: { url: string };
    }[];
    expect(profiles.map((profile) => [profile.kind, profile.request.url])).toEqual([
      ["task", "send-email 2"],
      ["task", "send-email 1"],
    ]);
  });
});
