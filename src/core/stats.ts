import { fromRequest, type Profile, type ProfileKind } from "./profile.js";

export interface StatementStat {
  fingerprint: string;
  /** One of the statements with this shape. */
  sql: string;
  count: number;
  totalMs: number;
  maxMs: number;
  /** The profile with the slowest one. */
  token: string;
}

/** How many profiles there are of each kind: documents, calls, scripts, tasks… */
export type KindCounts = Partial<Record<ProfileKind, number>>;

/** How many of these profiles there are of each kind. */
export function countKinds(profiles: Profile[]): KindCounts {
  const kinds: KindCounts = {};
  for (const { kind } of profiles) kinds[kind] = (kinds[kind] ?? 0) + 1;
  return kinds;
}

export interface Stats {
  profiles: number;
  kinds: KindCounts;
  slowest: StatementStat[];
  repeated: StatementStat[];
  models: { model: string; operations: number; totalMs: number }[];
  routes: { path: string; requests: number; queries: number; dbTimeMs: number; warnings: number }[];
}

const TOP = 10;
const round = (ms: number) => Math.round(ms * 100) / 100;

/** What the stored profiles add up to: the statements to look at first, by model, and by route for requests. */
export function stats(profiles: Profile[]): Stats {
  const statements = new Map<string, StatementStat>();
  const models = new Map<string, Stats["models"][number]>();
  const routes = new Map<string, Stats["routes"][number]>();
  for (const profile of profiles) {
    for (const query of profile.queries) {
      const ms = query.durationMs ?? 0;
      const stat = statements.get(query.fingerprint) ?? {
        fingerprint: query.fingerprint,
        sql: query.sql,
        count: 0,
        totalMs: 0,
        maxMs: -1,
        token: profile.token,
      };
      stat.count += 1;
      stat.totalMs = round(stat.totalMs + ms);
      if (ms > stat.maxMs) Object.assign(stat, { maxMs: ms, sql: query.sql, token: profile.token });
      statements.set(query.fingerprint, stat);
    }
    for (const op of profile.operations) {
      const name = op.model ?? op.action;
      const model = models.get(name) ?? { model: name, operations: 0, totalMs: 0 };
      model.operations += 1;
      model.totalMs = round(model.totalMs + (op.durationMs ?? 0));
      models.set(name, model);
    }
    if (!fromRequest(profile)) continue;
    const path = profile.request.url.split("?")[0]!;
    const route = routes.get(path) ?? { path, requests: 0, queries: 0, dbTimeMs: 0, warnings: 0 };
    route.requests += 1;
    route.queries += profile.summary.queryCount;
    route.dbTimeMs = round(route.dbTimeMs + profile.summary.dbTimeMs);
    route.warnings += profile.warnings.length;
    routes.set(path, route);
  }
  const all = [...statements.values()];
  return {
    profiles: profiles.length,
    kinds: countKinds(profiles),
    slowest: [...all].sort((a, b) => b.maxMs - a.maxMs).slice(0, TOP),
    repeated: [...all].sort((a, b) => b.count - a.count).slice(0, TOP),
    models: [...models.values()].sort((a, b) => b.totalMs - a.totalMs),
    routes: [...routes.values()].sort((a, b) => b.dbTimeMs - a.dbTimeMs),
  };
}
