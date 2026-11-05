import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { Server } from "node:http";
import { registerHooks } from "node:module";
import { enabled, formatProfile, listProfiles } from "../core/index.js";
import { shareProfiler, type Shared } from "./join.js";
import { profileRequests } from "./requests.js";
import { profilerServer } from "./server.js";
import { addsConditions } from "./support.js";

const LISTENING = "tracing:net.server.listen:asyncEnd";
const PACKAGE = "query-profiler";
// Where staying off is the point: no notice.
const QUIET = new Set(["production", "test"]);

// Loaded before the app by its development command: node --import query-profiler/register server.js
if (enabled() && !addsConditions()) {
  console.warn(
    `[query-profiler] Off: it needs Node 22.19+ or 24.5+, and this is ${process.version}.`,
  );
} else if (enabled()) {
  // The app's own imports of the profiler (query-profiler/prisma) get its real code, as with
  // --conditions=development. A synchronous hook, so require() follows it too, not only import.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== PACKAGE && !specifier.startsWith(`${PACKAGE}/`))
        return nextResolve(specifier, context);
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "development"],
      });
    },
  });
  let own: Server | undefined;
  let shared: Shared | undefined;
  const log = process.env.QUERY_PROFILER_LOG === "1";
  profileRequests({
    skip: (server) => server === own,
    onProfile: (profile) => {
      if (log) console.log(formatProfile(profile));
      shared?.send(profile);
    },
  });
  const host = process.env.QUERY_PROFILER_HOST;
  // Serve the profiler, or share the one another process already serves on its port; and take
  // that port over when that process goes.
  const open = () => {
    shared = undefined;
    own = profilerServer({
      onListening: (url) =>
        console.log(`[query-profiler] ${url}${host ? ` (listening on ${host})` : ""}`),
      onJoin: (url) => {
        console.log(`[query-profiler] ${url} (shared with another process)`);
        shared = shareProfiler(url, open);
        // What finished before this process knew it would share: the other one skips repeats.
        for (const profile of listProfiles().reverse()) shared.send(profile);
      },
    });
  };
  // The profiler opens its port once the app opens one, so a process that only launches the
  // app (a CLI run with NODE_OPTIONS) never takes it.
  const onListening = () => {
    unsubscribe(LISTENING, onListening);
    open();
  };
  subscribe(LISTENING, onListening);
} else if (process.env.QUERY_PROFILER_DISABLED !== "1" && !QUIET.has(process.env.NODE_ENV ?? "")) {
  console.warn(
    `[query-profiler] Off: NODE_ENV is "${process.env.NODE_ENV}". It runs with NODE_ENV=development, or with NODE_ENV unset.`,
  );
}
