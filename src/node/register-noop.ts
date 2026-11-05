// Node picked this empty preload because the dev command lacks --conditions=development. Say so,
// unless the profiler would stay off anyway.
const environment = process.env.NODE_ENV;
if (
  (environment === undefined || environment === "development") &&
  process.env.QUERY_PROFILER_DISABLED !== "1"
)
  console.warn(
    "[query-profiler] Off: add --conditions=development next to --import query-profiler/register, or Node loads the profiler's empty version.",
  );

export {};
