import { formatProfile } from "query-profiler";
import { profilerMiddleware } from "query-profiler/react-router";

export const dbProfiler = profilerMiddleware({
  onProfile: (profile) => console.log(formatProfile(profile)),
});
