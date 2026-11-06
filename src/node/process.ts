import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { Server } from "node:http";
import {
  formatProfile,
  listProfiles,
  onProfile,
  profileOutside,
  snapshotProfile,
  type Profile,
} from "../core/index.js";
import { shareProfiler, type Shared } from "./join.js";
import { profileRequests } from "./requests.js";
import { scriptName, scriptReport, sendBeforeExit } from "./script.js";
import { findProfiler, profilerServer } from "./server.js";

const LISTENING = "tracing:net.server.listen:asyncEnd";
const STREAM_MS = 500;

/**
 * Profiles everything this process does: its requests, once it listens, and serves the profiler or
 * shares another process's; before that, its run as a script, sent to a profiler if one is open.
 */
export function profileProcess(): void {
  let own: Server | undefined;
  let shared: { url: string; profiler: Shared } | undefined;
  let listened = false;
  let looked: Promise<void> | undefined;
  let lookedUp = false;
  const log = process.env.QUERY_PROFILER_LOG === "1";
  const host = process.env.QUERY_PROFILER_HOST;

  function join(url: string) {
    // A server takes the port over when that process goes; a script does without.
    shared = {
      url,
      profiler: shareProfiler(url, () => (listened ? open() : (shared = undefined))),
    };
  }

  // Serve the profiler, or share the one another process already serves on its port.
  function open() {
    shared = undefined;
    own = profilerServer({
      onListening: (url) =>
        console.log(`[query-profiler] ${url}${host ? ` (listening on ${host})` : ""}`),
      onJoin: (url) => {
        console.log(`[query-profiler] ${url} (shared with another process)`);
        join(url);
        // What finished before this process knew it would share: the other one skips repeats.
        for (const profile of listProfiles().reverse()) shared?.profiler.send(profile);
      },
    });
  }

  // A process that has not listened (a script, a worker) has no port: it looks for a profiler.
  function look(): Promise<void> {
    return (looked ??= findProfiler().then((url) => {
      lookedUp = true;
      if (url && !shared && !listened) join(url);
    }));
  }

  profileRequests({
    skip: (server) => server === own,
    onProfile: (profile) => log && console.log(formatProfile(profile)),
  });
  onProfile((profile) => {
    if (shared) shared.profiler.send(profile);
    else if (!listened) void look().then(() => shared?.profiler.send(profile));
  });

  const outside = profileOutside({
    script: scriptName(),
    framework: { name: "node" },
    onOpen: (active) => active.profile.kind === "script" && void look(),
  });
  // A script's run shows in the profiler as it goes, not only once it ends.
  let sentSize = 0;
  const stream = setInterval(() => {
    const script = outside.script;
    const size = script ? script.profile.queries.length + script.unrecorded : 0;
    if (!script || size === sentSize) return;
    sentSize = size;
    shared?.profiler.send(snapshotProfile(script));
  }, STREAM_MS);
  stream.unref();

  const report = (profile: Profile | undefined, url?: string) =>
    profile?.kind === "script" && console.log(scriptReport(profile, url));
  process.once("beforeExit", () => {
    if (outside.script) void look().then(() => report(outside.close(), shared?.url));
  });
  process.once("exit", () => {
    if (!outside.script) return;
    const last = shared;
    shared = undefined;
    const profile = outside.close();
    // Still looking for a profiler when the script exited: the one that sends it looks too.
    if (profile && (last || !lookedUp)) report(profile, sendBeforeExit(profile, last?.url));
    else report(profile);
  });

  // The profiler opens its port once the app opens one, so a process that only launches the
  // app (a CLI run with NODE_OPTIONS) never takes it. What ran before was the app's startup.
  const onListening = () => {
    unsubscribe(LISTENING, onListening);
    listened = true;
    clearInterval(stream);
    outside.serve();
    if (!shared) open();
  };
  subscribe(LISTENING, onListening);
}
