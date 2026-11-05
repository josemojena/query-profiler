import type { Profile } from "./profile.js";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line per request, for a dev server console. */
export function formatProfile(profile: Profile): string {
  const { request, response, summary } = profile;
  const warnings = profile.warnings.length ? ` · ${count(profile.warnings.length, "warning")}` : "";
  return `[query-profiler] ${request.method} ${request.url} ${response?.status ?? "-"} · ${count(summary.queryCount, "query", "queries")} · ${summary.dbTimeMs} ms in db · ${count(summary.operationCount, "operation")}${warnings} · ${profile.durationMs} ms · ${profile.token}`;
}
