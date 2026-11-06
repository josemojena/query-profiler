import { registerHooks } from "node:module";
import { enabled } from "../core/index.js";
import { profileProcess } from "./process.js";
import { addsConditions } from "./support.js";

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
  profileProcess();
} else if (process.env.QUERY_PROFILER_DISABLED !== "1" && !QUIET.has(process.env.NODE_ENV ?? "")) {
  console.warn(
    `[query-profiler] Off: NODE_ENV is "${process.env.NODE_ENV}". It runs with NODE_ENV=development, or with NODE_ENV unset.`,
  );
}
