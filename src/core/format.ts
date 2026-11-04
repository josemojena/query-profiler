import type { Profile } from "./profile.js";

/** One line per request, for a dev server console. */
export function formatProfile(profile: Profile): string {
  const { request, response, summary } = profile;
  const warnings = profile.warnings.length ? ` · ${profile.warnings.length} warnings` : "";
  return `[query-profiler] ${request.method} ${request.url} ${response?.status ?? "-"} · ${summary.queryCount} queries · ${summary.dbTimeMs} ms in db · ${summary.operationCount} operations${warnings} · ${profile.durationMs} ms · ${profile.token}`;
}
