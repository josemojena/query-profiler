import { enabled } from "../core/index.js";
import { profileAdapter, type AdapterFactory } from "./adapter.js";
import { stampPlugin } from "./stamp.js";

/**
 * PrismaClient options with the driver adapter profiled and the operation stamp added to the SQL
 * comments; the options untouched outside development.
 */
export function withProfiler<T extends { adapter: AdapterFactory }>(options: T): T {
  if (!enabled()) return options;
  const { comments = [] } = options as { comments?: unknown[] };
  return {
    ...options,
    adapter: profileAdapter(options.adapter),
    comments: [...comments, stampPlugin],
  };
}
