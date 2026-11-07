import type { Database, Provider } from "../core/index.js";
import type { IndexAdvice } from "./advisor.js";
import { readCatalog, type Table, type TableName } from "./catalog.js";
import { engineOf, explain, type NoPlan } from "./explain.js";
import { allSteps, type Engine, type Plan } from "./plan.js";
import { COMMON } from "./rules/common.js";
import {
  appliesTo,
  fill,
  holds,
  parseWhen,
  type Rule,
  type Severity,
  type SubjectKind,
} from "./rules/engine.js";
import { MARIADB } from "./rules/mariadb.js";
import { MYSQL } from "./rules/mysql.js";
import { POSTGRES } from "./rules/postgres.js";
import { SQLITE } from "./rules/sqlite.js";
import { fixFor, type Fix } from "./rules/fixes.js";
import { subjects, type Analyzed } from "./rules/subjects.js";
import type { PrismaNames } from "./schema.js";
import { readStatement } from "./statement.js";

export interface Finding {
  rule: string;
  severity: Severity;
  /** About this query, or about a table it reads whatever the query: a key or an index. */
  about: "query" | "table";
  message: string;
  table?: string;
  column?: string;
  /** The plan step it is about, by its place among allSteps(plan.steps). */
  step?: number;
  fix?: Fix;
  /** The engine's manual on it. */
  docs?: string;
}

export interface Analysis {
  engine: Engine;
  version: string;
  plan?: Plan;
  /** Why there is no plan, when there is none. */
  noPlan?: NoPlan;
  tables: Table[];
  findings: Finding[];
}

/** What trying the suggested index in a rolled back transaction showed. */
export interface Trial {
  index: string;
  /** The database chose the index once it existed. */
  used: boolean;
  /** The plan's estimated cost without the index, and with it. */
  before?: number;
  after?: number;
  plan: Plan;
}

/** Every rule the analysis knows, in the order they are checked. */
export const RULES: Rule[] = [...COMMON, ...POSTGRES, ...MYSQL, ...MARIADB, ...SQLITE];

const COMPILED = RULES.map(([id, subject, engines, when, severity, message, fix, docs]) => ({
  id,
  subject,
  engines,
  when: parseWhen(when),
  severity,
  message,
  fix,
  docs,
}));
const ORDER: Record<Severity, number> = { problem: 0, warning: 1, info: 2 };

/** A query's plan, its tables in the catalog, and what the rules find in them. */
export async function analyzeQuery(
  database: Database,
  query: { sql: string; params: unknown[]; rows?: number },
  options: { measure?: boolean; names?: PrismaNames } = {},
): Promise<Analysis> {
  const { engine, version } = await engineOf(database);
  const statement = readStatement(query.sql, engine);
  const planned = await explain(database, query, options);
  const plan = "problem" in planned ? undefined : planned;
  const relations: TableName[] = plan
    ? allSteps(plan.steps).flatMap((step) => (step.relation ? [{ name: step.relation }] : []))
    : [];
  // A catalog the connection may not read still leaves the plan and the SQL to look at.
  const tables = await readCatalog(database.run, engine, [...statement.tables, ...relations]).catch(
    () => [],
  );
  const found = subjects({
    engine,
    version,
    statement,
    plan,
    tables,
    params: query.params,
    returned: query.rows,
  });
  return {
    engine,
    version,
    ...(plan ? { plan } : { noPlan: planned as NoPlan }),
    tables,
    findings: findingsOf(found, engine, version, options.names),
  };
}

/** What the rules find in a query's SQL and parameters alone, without asking the database. */
export function readFindings(
  query: { sql: string; params: unknown[]; rows?: number },
  provider: Provider,
  names?: PrismaNames,
): Finding[] {
  const engine: Engine = provider;
  const statement = readStatement(query.sql, engine);
  const found = subjects({
    engine,
    statement,
    tables: [],
    params: query.params,
    returned: query.rows,
  }).filter((subject) => subject.kind === "condition" || subject.kind === "query");
  return findingsOf(found, engine, "", names);
}

/**
 * The plan once the suggested index exists, created in a transaction that is rolled back. Only
 * PostgreSQL and SQLite can undo a CREATE INDEX; on a small table PostgreSQL is told to avoid full
 * reads, so the plan shows whether the index can serve rather than whether it is worth it yet.
 */
export async function tryIndex(
  database: Database,
  query: { sql: string; params: unknown[] },
  advice: Pick<IndexAdvice, "name" | "sql">,
): Promise<Trial | NoPlan> {
  const { engine } = await engineOf(database);
  if (engine !== "postgres" && engine !== "sqlite")
    return {
      problem: "not_triable",
      message: "MySQL and MariaDB commit a CREATE INDEX at once, so it cannot be tried and undone.",
    };
  const before = await explain(database, query);
  const name = `qp_trial_${Math.random().toString(36).slice(2, 10)}`;
  const sql = advice.sql.replace(/^CREATE INDEX\s+("[^"]*"|`[^`]*`)/, `CREATE INDEX "${name}"`);
  const after = await database.rolledBack(async (run) => {
    if (engine === "postgres") await run("SET LOCAL statement_timeout = '5s'");
    await run(sql);
    if (engine === "postgres") await run("SET LOCAL enable_seqscan = off");
    return explain(database, query, { run });
  });
  if ("problem" in after) return after;
  const cost = (plan: Plan | NoPlan) => ("problem" in plan ? undefined : plan.steps[0]?.cost);
  return {
    index: advice.name,
    // Avoiding full reads only discourages them: the index counts once it looks rows up.
    used: allSteps(after.steps).some((step) => step.index === name && step.lookup !== undefined),
    before: cost(before),
    after: cost(after),
    plan: { ...after, raw: after.raw.replaceAll(name, advice.name) },
  };
}

function findingsOf(
  found: Analyzed[],
  engine: Engine,
  version: string,
  names?: PrismaNames,
): Finding[] {
  const byKind = new Map<SubjectKind, Analyzed[]>();
  for (const subject of found)
    byKind.set(subject.kind, [...(byKind.get(subject.kind) ?? []), subject]);
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const rule of COMPILED) {
    if (!appliesTo(rule.engines, engine, version)) continue;
    for (const subject of byKind.get(rule.subject) ?? []) {
      if (!holds(rule.when, subject.facts)) continue;
      const message = fill(rule.message, subject.values);
      const key = `${rule.id}\u0000${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const fix = fixFor(rule.fix, subject, engine, version, names);
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        about: subject.kind === "foreign-key" || subject.kind === "index" ? "table" : "query",
        message,
        ...(subject.table ? { table: subject.table.name } : {}),
        ...(subject.column ? { column: subject.column } : {}),
        ...(subject.step === undefined ? {} : { step: subject.step }),
        ...(fix ? { fix } : {}),
        ...(rule.docs ? { docs: rule.docs } : {}),
      });
    }
  }
  return findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
