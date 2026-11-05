import { subscribe, unsubscribe } from "node:diagnostics_channel";
import type { Server } from "node:http";
import { registerHooks } from "node:module";
import { enabled, formatProfile } from "../core/index.js";
import { profileRequests } from "./requests.js";
import { profilerServer } from "./server.js";

const LISTENING = "tracing:net.server.listen:asyncEnd";
const PACKAGE = "query-profiler";
// Where staying off is the point: no notice.
const QUIET = new Set(["production", "test"]);

// Loaded before the app by its development command: node --import query-profiler/register server.js
if (enabled()) {
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
  profileRequests({
    skip: (server) => server === own,
    onProfile:
      process.env.QUERY_PROFILER_LOG === "1"
        ? (profile) => console.log(formatProfile(profile))
        : undefined,
  });
  // The profiler opens its port once the app opens one, so a process that only launches the
  // app (a CLI run with NODE_OPTIONS) never takes it.
  const onListening = () => {
    unsubscribe(LISTENING, onListening);
    const host = process.env.QUERY_PROFILER_HOST;
    own = profilerServer({
      onListening: (url) =>
        console.log(`[query-profiler] ${url}${host ? ` (listening on ${host})` : ""}`),
    });
  };
  subscribe(LISTENING, onListening);
} else if (process.env.QUERY_PROFILER_DISABLED !== "1" && !QUIET.has(process.env.NODE_ENV ?? "")) {
  console.warn(
    `[query-profiler] Off: NODE_ENV is "${process.env.NODE_ENV}". It runs with NODE_ENV=development, or with NODE_ENV unset.`,
  );
}
