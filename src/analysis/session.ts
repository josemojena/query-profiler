import type { Database, Profile, QueryRecord } from "../core/index.js";
import { analyzeQuery, type Analysis, type Finding } from "./analyze.js";
import { statementKind } from "./explain.js";
import { allSteps, type Engine } from "./plan.js";
import type { Severity } from "./rules/engine.js";

/** One statement shape of the session: every query with the same SQL but its values. */
export interface Shape {
  fingerprint: string;
  sql: string;
  runs: number;
  totalMs: number;
  routes: string[];
  /** The slowest run, to open it. */
  example: { token: string; queryId: string };
}

/** An index to add, with every statement shape it would serve. */
export interface IndexPick {
  table: string;
  columns: string[];
  name: string;
  prisma?: string;
  sql?: string;
  shapes: Shape[];
  runs: number;
  totalMs: number;
  routes: string[];
  /** Smaller indexes suggested for other shapes, which this one serves too: no need for them. */
  covers: string[];
}

/** A rule across the session: how many shapes it found, how often they ran, and for how long. */
export interface RuleSum {
  rule: string;
  severity: Severity;
  /** What it said of the shape that took the longest. */
  message: string;
  shapes: number;
  runs: number;
  totalMs: number;
  example: Shape["example"];
}

export interface TableUse {
  table: string;
  shapes: number;
  runs: number;
  totalMs: number;
  /** Statement shapes that read every row of it. */
  fullReads: number;
}

export interface SessionAnalysis {
  /** The stored requests it adds up. */
  requests: number;
  /** Statement shapes in the session. */
  shapes: number;
  analyzed: number;
  /** Shapes the database could not be asked about: no connection, or no plan for them. */
  skipped: number;
  /** Shapes the database refused to plan, with what it said. */
  failed: { sql: string; message: string }[];
  /** The databases that answered, once each. */
  databases: { engine: Engine; version: string }[];
  indexes: IndexPick[];
  rules: RuleSum[];
  tables: TableUse[];
  /** What holds for a table whatever the query, once each. */
  notes: Finding[];
}

type Analyze = (database: Database, query: QueryRecord) => Promise<Analysis>;

const ORDER: Record<Severity, number> = { problem: 0, warning: 1, info: 2 };
const AT_ONCE = 4;
const round = (ms: number) => Math.round(ms * 100) / 100;

/**
 * What the session's stored requests add up to: each statement shape analyzed once, through its
 * slowest run, and the indexes, rules and tables ranked by the time at stake.
 */
export async function analyzeSession(
  profiles: Profile[],
  find: (query: QueryRecord) => Database | undefined,
  analyze: Analyze = analyzeQuery,
): Promise<SessionAnalysis> {
  const groups = shapesOf(profiles);
  const analyzed: { shape: Shape; analysis: Analysis }[] = [];
  const failed: SessionAnalysis["failed"] = [];
  let skipped = 0;
  const pending = [...groups.values()];
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const database = statementKind(next.query.sql) ? find(next.query) : undefined;
      if (!database) {
        skipped += 1;
        continue;
      }
      try {
        analyzed.push({ shape: next.shape, analysis: await analyze(database, next.query) });
      } catch (error) {
        failed.push({
          sql: next.shape.sql,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  const databases = new Map(
    analyzed.map(({ analysis: { engine, version } }) => [
      `${engine} ${version}`,
      { engine, version },
    ]),
  );
  return {
    requests: profiles.length,
    shapes: groups.size,
    analyzed: analyzed.length,
    skipped,
    failed,
    databases: [...databases.values()],
    indexes: indexPicks(analyzed),
    rules: ruleSums(analyzed),
    tables: tableUses(analyzed),
    notes: [
      ...new Map(
        analyzed
          .flatMap(({ analysis }) => analysis.findings)
          .filter((finding) => finding.about === "table")
          .map((finding) => [finding.message, finding]),
      ).values(),
    ],
  };
}

function shapesOf(profiles: Profile[]): Map<string, { shape: Shape; query: QueryRecord }> {
  const groups = new Map<string, { shape: Shape; query: QueryRecord; routes: Set<string> }>();
  for (const profile of profiles) {
    const route = profile.request.url.split("?")[0]!;
    for (const query of profile.queries) {
      if (!statementKind(query.sql)) continue;
      const key = `${query.database?.provider ?? ""}\u0000${query.fingerprint}`;
      const ms = query.durationMs ?? 0;
      const group = groups.get(key);
      if (!group) {
        groups.set(key, {
          shape: {
            fingerprint: query.fingerprint,
            sql: query.sql,
            runs: 1,
            totalMs: ms,
            routes: [],
            example: { token: profile.token, queryId: query.id },
          },
          query,
          routes: new Set([route]),
        });
        continue;
      }
      group.shape.runs += 1;
      group.shape.totalMs = round(group.shape.totalMs + ms);
      group.routes.add(route);
      if (ms > (group.query.durationMs ?? 0)) {
        group.query = query;
        group.shape.example = { token: profile.token, queryId: query.id };
      }
    }
  }
  return new Map(
    [...groups].map(([key, { shape, query, routes }]) => [
      key,
      { shape: { ...shape, routes: [...routes] }, query },
    ]),
  );
}

function indexPicks(analyzed: { shape: Shape; analysis: Analysis }[]): IndexPick[] {
  const picks = new Map<string, IndexPick>();
  for (const { shape, analysis } of analyzed) {
    const seen = new Set<string>();
    for (const finding of analysis.findings) {
      const fix = finding.fix;
      // A table's note (a foreign key with no index) fixes no particular query: it stays a note.
      if (finding.about !== "query" || !fix?.on || !fix.index || seen.has(fix.index)) continue;
      seen.add(fix.index);
      const key = `${fix.on.table}\u0000${fix.on.columns.join(",")}`;
      const pick = picks.get(key) ?? {
        table: fix.on.table,
        columns: fix.on.columns,
        name: fix.index,
        prisma: fix.prisma,
        sql: fix.sql,
        shapes: [],
        runs: 0,
        totalMs: 0,
        routes: [],
        covers: [],
      };
      if (!pick.shapes.includes(shape)) pick.shapes.push(shape);
      picks.set(key, pick);
    }
  }
  // An index serves the queries of any index its columns start with: (a) is no longer needed
  // next to (a, b).
  const names = (pick: IndexPick) => pick.columns.map((column) => column.replace(/ DESC$/, ""));
  const all = [...picks.values()].sort((a, b) => b.columns.length - a.columns.length);
  const kept: IndexPick[] = [];
  for (const pick of all) {
    const wider = kept.find(
      (other) =>
        other.table === pick.table &&
        other.columns.length > pick.columns.length &&
        names(pick).every((column, at) => names(other)[at] === column),
    );
    if (!wider) {
      kept.push(pick);
      continue;
    }
    for (const shape of pick.shapes) if (!wider.shapes.includes(shape)) wider.shapes.push(shape);
    wider.covers.push(pick.name, ...pick.covers);
  }
  for (const pick of kept) {
    pick.shapes.sort((a, b) => b.totalMs - a.totalMs);
    pick.runs = pick.shapes.reduce((sum, shape) => sum + shape.runs, 0);
    pick.totalMs = round(pick.shapes.reduce((sum, shape) => sum + shape.totalMs, 0));
    pick.routes = [...new Set(pick.shapes.flatMap((shape) => shape.routes))];
  }
  return kept.sort((a, b) => b.totalMs - a.totalMs || b.runs - a.runs);
}

function ruleSums(analyzed: { shape: Shape; analysis: Analysis }[]): RuleSum[] {
  const sums = new Map<string, RuleSum>();
  for (const { shape, analysis } of analyzed) {
    const seen = new Set<string>();
    for (const finding of analysis.findings) {
      if (finding.about !== "query" || seen.has(finding.rule)) continue;
      seen.add(finding.rule);
      const sum = sums.get(finding.rule);
      if (!sum) {
        sums.set(finding.rule, {
          rule: finding.rule,
          severity: finding.severity,
          message: finding.message,
          shapes: 1,
          runs: shape.runs,
          totalMs: shape.totalMs,
          example: shape.example,
        });
        continue;
      }
      if (shape.totalMs > sum.totalMs / sum.shapes) {
        sum.message = finding.message;
        sum.example = shape.example;
      }
      sum.shapes += 1;
      sum.runs += shape.runs;
      sum.totalMs = round(sum.totalMs + shape.totalMs);
    }
  }
  return [...sums.values()].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || b.totalMs - a.totalMs,
  );
}

function tableUses(analyzed: { shape: Shape; analysis: Analysis }[]): TableUse[] {
  const uses = new Map<string, TableUse>();
  for (const { shape, analysis } of analyzed) {
    const steps = analysis.plan ? allSteps(analysis.plan.steps) : [];
    const full = new Set(
      steps
        .filter((step) => step.kind === "read" && step.access === "full")
        .map((step) => step.relation ?? step.table),
    );
    for (const table of new Set(analysis.tables.map((each) => each.name))) {
      const use = uses.get(table) ?? { table, shapes: 0, runs: 0, totalMs: 0, fullReads: 0 };
      use.shapes += 1;
      use.runs += shape.runs;
      use.totalMs = round(use.totalMs + shape.totalMs);
      if (full.has(table)) use.fullReads += 1;
      uses.set(table, use);
    }
  }
  return [...uses.values()].sort((a, b) => b.totalMs - a.totalMs);
}
