const ENVIRONMENTS = new Set(["development", undefined]);

/**
 * Only in development: with NODE_ENV=development, or unset, as servers without a bundler leave it.
 * Never in production or test runs, nor with QUERY_PROFILER_DISABLED=1 (end-to-end suites, for one).
 */
export const enabled = () =>
  ENVIRONMENTS.has(process.env.NODE_ENV) && process.env.QUERY_PROFILER_DISABLED !== "1";
