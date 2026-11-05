import { enabled, formatProfile } from "../core/index.js";
import { profileRequests } from "./requests.js";
import { profilerServer } from "./server.js";

// Loaded before the app by the dev script: `--import query-profiler/register`.
if (enabled()) {
  const server = profilerServer((url) => console.log(`[query-profiler] ${url}`));
  profileRequests({ skip: server, onProfile: (profile) => console.log(formatProfile(profile)) });
}
