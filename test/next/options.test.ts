import { expect, it } from "vitest";
import { nextCommand } from "../../src/next/options.js";

const PROFILER =
  "--conditions=development --enable-source-maps --import query-profiler/next/register";

it("passes every argument to Next as given, and loads the profiler into `next dev`", () => {
  expect(nextCommand(["dev", "--turbopack", "-p", "3001", "--experimental-https"])).toEqual({
    args: ["dev", "--turbopack", "-p", "3001", "--experimental-https"],
    nodeOptions: PROFILER,
  });
});

it("keeps the NODE_OPTIONS already set", () => {
  expect(nextCommand(["dev"], " --max-old-space-size=4096 ").nodeOptions).toBe(
    `--max-old-space-size=4096 ${PROFILER}`,
  );
});

it("leaves every other command untouched, so builds never load the profiler", () => {
  for (const args of [["build"], ["start", "-p", "3000"], ["lint"], []])
    expect(nextCommand(args, "--inspect")).toEqual({ args, nodeOptions: "--inspect" });
});
