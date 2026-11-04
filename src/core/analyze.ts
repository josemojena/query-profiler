import type { Profile, QueryRecord, Warning } from "./profile.js";

export const SLOW_QUERY_MS = 100;
export const REPEATED_QUERIES = 5;

const TRANSACTION_CONTROL =
  /^\s*(begin|start transaction|commit|rollback|savepoint|release|set transaction)\b/i;

export const isTransactionControl = (sql: string) => TRANSACTION_CONTROL.test(sql);

/** N+1 (the same statement shape again and again), duplicates (same SQL, same params) and slow queries. */
export function analyze(profile: Profile): Warning[] {
  const queries = profile.queries.filter((query) => !isTransactionControl(query.sql));
  const warnings: Warning[] = [];
  for (const [fingerprint, group] of groupBy(queries, (query) => query.fingerprint))
    if (group.length >= REPEATED_QUERIES)
      warnings.push({ kind: "n+1", fingerprint, queryIds: ids(group) });
  for (const group of groupBy(
    queries,
    (query) => `${query.sql}\u0000${JSON.stringify(query.params)}`,
  ).values())
    if (group.length > 1)
      warnings.push({
        kind: "duplicate",
        fingerprint: group[0]!.fingerprint,
        queryIds: ids(group),
      });
  for (const query of queries)
    if ((query.durationMs ?? 0) >= SLOW_QUERY_MS)
      warnings.push({ kind: "slow", fingerprint: query.fingerprint, queryIds: [query.id] });
  return warnings;
}

/** The time the database was busy: overlapping queries count once. */
export function busyMs(queries: QueryRecord[]): number {
  const spans = queries
    .filter((query) => query.durationMs !== undefined)
    .map((query) => [query.startMs, query.startMs + query.durationMs!] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | undefined;
  for (const [start, end] of spans) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total * 100) / 100;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const ids = (queries: QueryRecord[]) => queries.map((query) => query.id);
