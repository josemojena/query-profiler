#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { nextCommand } from "./options.js";

// Next's own CLI runs with every argument as given; `dev` gets the profiler through NODE_OPTIONS.
const next = createRequire(join(process.cwd(), "package.json")).resolve("next/dist/bin/next");
const { args, nodeOptions } = nextCommand(process.argv.slice(2), process.env.NODE_OPTIONS);
const child = spawn(process.execPath, [next, ...args], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
