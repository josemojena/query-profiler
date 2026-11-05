import { enabled, formatProfile } from "../core/index.js";
import { profileRequests } from "./requests.js";

// Loaded by `query-profiler-next dev` before Next, through NODE_OPTIONS.
if (enabled()) profileRequests({ onProfile: (profile) => console.log(formatProfile(profile)) });
