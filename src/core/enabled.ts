/** Only in development, and not when QUERY_PROFILER_DISABLED=1 (end-to-end suites, for one). */
export const enabled = () =>
  process.env.NODE_ENV === "development" && process.env.QUERY_PROFILER_DISABLED !== "1";
