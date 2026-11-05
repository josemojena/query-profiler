import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { beforeAll, expect, it } from "vitest";

const CORE = new URL("../../src/core/index.ts", import.meta.url).pathname;
const BUILT_CORE = new URL("../../dist/core/index.js", import.meta.url).pathname;

// The app's code, bundled with the profiler the way Next bundles a server module, in a folder of
// its own; and Next's habit of formatting stack traces itself.
const APP = `
import { captureOrigin, createHandler } from ${JSON.stringify(CORE)};

Error.prepareStackTrace = (error, frames) =>
  [String(error), ...frames.map((frame) => \`    at \${frame.getFunctionName() ?? "<anonymous>"} (\${frame.getFileName()}:\${frame.getLineNumber()}:\${frame.getColumnNumber()})\`)].join("\\n");

function loadUsers() {
  return captureOrigin(); // the-call
}

const origin = loadUsers()[0];
const ui = await createHandler()(new Request("http://localhost/_profiler/ui/index.js"));
console.log(JSON.stringify({ origin, ui: ui.status }));
`;

let app = "";
let bundle = "";

beforeAll(async () => {
  // The real path: on macOS the temporary folder is a symlink, and source maps resolve from the real one.
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-bundled-"));
  app = join(dir, "app.ts");
  bundle = join(dir, "server.mjs");
  writeFileSync(app, APP);
  await build({
    entryPoints: [app],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true,
  });
});

const run = () =>
  JSON.parse(
    execFileSync(process.execPath, ["--enable-source-maps", bundle], {
      // Without the NODE_PATH pnpm gives the test runner, through which any folder finds the package.
      env: { ...process.env, NODE_ENV: "development", NODE_PATH: "" },
      encoding: "utf8",
    }),
  ) as { origin: { file: string; line: number; fn: string }; ui: number };

it("finds the app's line through the bundle's source map, even with the stack formatted by the framework", () => {
  const line =
    readFileSync(app, "utf8")
      .split("\n")
      .findIndex((text) => text.includes("// the-call")) + 1;
  expect(run().origin).toMatchObject({ file: app, line, fn: "loadUsers" });
});

it("serves the bar's code when a bundler has moved the profiler out of its package", () => {
  expect(run().ui).toBe(200);
});

it("finds the app's line when Node already maps the stack itself, as with tsx", async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-tsx-"));
  const file = join(dir, "app.ts");
  writeFileSync(
    file,
    `import { captureOrigin } from ${JSON.stringify(CORE)};

type User = { id: number };

function loadUsers(): User[] {
  const origin = captureOrigin()[0]; // the-call
  console.log(JSON.stringify(origin));
  return [];
}

loadUsers();
`,
  );
  const tsx = new URL("../../node_modules/.bin/tsx", import.meta.url).pathname;
  const origin = JSON.parse(
    execFileSync(tsx, [file], { env: { ...process.env, NODE_PATH: "" }, encoding: "utf8" }),
  ) as { file: string; line: number };
  const line =
    readFileSync(file, "utf8")
      .split("\n")
      .findIndex((text) => text.includes("// the-call")) + 1;
  expect(origin).toMatchObject({ file, line });
});

it.each([
  ["in a file of its own", "linked"],
  ["inline", "inline"],
] as const)(
  "finds the app's line in compiled code run without --enable-source-maps, its source map %s",
  async (_where, sourcemap) => {
    const dir = mkdtempSync(join(realpathSync(tmpdir()), "query-profiler-compiled-"));
    const source = join(dir, "users.ts");
    writeFileSync(
      source,
      `import { captureOrigin } from ${JSON.stringify(BUILT_CORE)};

type User = { id: number };

export function loadUsers(): User[] {
  console.log(JSON.stringify(captureOrigin()[0])); // the-call
  return [];
}

loadUsers();
`,
    );
    // Compiled in place, as tsc does: one file out, its imports untouched, a comment to its map.
    const outfile = join(dir, "users.js");
    await build({ entryPoints: [source], outfile, format: "esm", sourcemap, logLevel: "silent" });
    const origin = JSON.parse(
      execFileSync(process.execPath, [outfile], {
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "", NODE_ENV: "development" },
        encoding: "utf8",
      }),
    ) as { file: string; line: number };
    const line =
      readFileSync(source, "utf8")
        .split("\n")
        .findIndex((text) => text.includes("// the-call")) + 1;
    expect(origin).toMatchObject({ file: source, line });
  },
);
