import { spawnSync } from "node:child_process";
import { fixesOf } from "../core/analysis-http.js";
import { formatProfile, formatWarnings, shownPath, type Profile } from "../core/index.js";

const SEND_TIMEOUT_MS = 2000;
const SERVER = new URL("./server.js", import.meta.url).href;
// Reads the profile from stdin, posts it to the profiler it is given or finds, and says which.
const POST = `import { readFileSync } from "node:fs";
import { findProfiler } from ${JSON.stringify(SERVER)};
const url = process.argv[1] || (await findProfiler());
const body = readFileSync(0, "utf8");
const headers = { "Content-Type": "application/json" };
const sent = url && (await fetch(url + "/api/profiles", { method: "POST", headers, body }).catch(() => undefined));
if (sent?.ok) process.stdout.write(url);`;

/** The file this process runs, as typed from the working directory: `prisma/seed.ts`. */
export const scriptName = (file = process.argv[1]) => (file ? shownPath(file) : "");

/** What a script did, for the terminal once it ends: its line, its warnings, and where to see it. */
export function scriptReport(profile: Profile, profilerUrl?: string): string {
  return [
    formatProfile(profile),
    ...formatWarnings(profile, fixesOf(profile)).map((line) => `  ${line}`),
    ...(profilerUrl ? [`  ${profilerUrl}/${profile.token}`] : []),
  ].join("\n");
}

/**
 * Sends a profile to the profiler at `profilerUrl`, or to the one it finds, and waits for it, for a
 * process that is exiting: `process.exit()` runs nothing asynchronous after it, so another process
 * sends it while this one waits. Returns where it went.
 */
export function sendBeforeExit(profile: Profile, profilerUrl = ""): string | undefined {
  const sent = spawnSync(process.execPath, ["--input-type=module", "-e", POST, profilerUrl], {
    input: JSON.stringify(profile),
    // Without the app's NODE_OPTIONS: the preload, among them, has nothing to do there.
    env: { ...process.env, NODE_OPTIONS: "" },
    encoding: "utf8",
    timeout: SEND_TIMEOUT_MS,
    stdio: ["pipe", "pipe", "ignore"],
  });
  return sent.stdout || undefined;
}
