import { profileAdapter, type AdapterFactory } from "./adapter.js";
import { stampPlugin } from "./stamp.js";

/** PrismaClient options with the driver adapter profiled and the operation stamp added to the SQL comments. */
export function withProfiler<T extends { adapter: AdapterFactory }>(options: T): T {
  const { comments = [] } = options as { comments?: unknown[] };
  return {
    ...options,
    adapter: profileAdapter(options.adapter),
    comments: [...comments, stampPlugin],
  };
}
