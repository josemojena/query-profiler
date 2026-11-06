import type { Database, RunSql } from "../core/index.js";
import { REDACTED } from "../core/redact.js";
import { parseJson, type Engine, type Plan, type PlanStep } from "./plan.js";
import { readMariadbPlan } from "./plans/mariadb.js";
import { readMysqlPlan, readMysqlTree } from "./plans/mysql.js";
import { readPostgresPlan } from "./plans/postgres.js";
import { readSqlitePlan, sqlitePlanText } from "./plans/sqlite.js";

export interface EngineInfo {
  engine: Engine;
  version: string;
}

/** Why a query has no plan, or no measured one, in words for the person looking at it. */
export interface NoPlan {
  problem: "not_explainable" | "not_measurable" | "not_triable";
  message: string;
}

const VERSION_QUERY: Record<Database["provider"], string> = {
  postgres: "SHOW server_version",
  mysql: "SELECT VERSION()",
  sqlite: "SELECT sqlite_version()",
};
const WRITES = new Set(["INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE"]);
// Past whitespace, comments and opening parentheses, to the statement's first word.
const FIRST_WORD = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\()*([A-Za-z]+)/;
const ISO_DATE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z$/;
const INTEGER = /^-?\d+$/;
// FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE, and MySQL's LOCK IN SHARE MODE.
const LOCKING =
  /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i;
const QUOTED = /'(?:[^']|'')*'|`(?:[^`]|``)*`|"(?:[^"]|"")*"/g;
// LIMIT n, OFFSET n, and MySQL's LIMIT offset, n.
const BEFORE_COUNT = /\b(?:LIMIT|OFFSET)\s*$|\bLIMIT\s+(?:\?|\$\d+)\s*,\s*$/i;
// What sanitize() stores in place of bytes and of a string longer than it keeps.
const BYTES = /^<\d+ bytes>$/;
const CUT_LENGTH = 2049;

const engines = new WeakMap<Database, Promise<EngineInfo>>();

/** The engine behind a connection and its version, asked once per connection. */
export function engineOf(database: Database): Promise<EngineInfo> {
  const known = engines.get(database);
  if (known) return known;
  const info = database.run(VERSION_QUERY[database.provider]).then(({ rows }): EngineInfo => {
    const answer = String(rows[0]?.[0] ?? "");
    const mariadb = database.provider === "mysql" && /mariadb/i.test(answer);
    return {
      engine: mariadb ? "mariadb" : database.provider,
      version: /^\d+(?:\.\d+)*/.exec(answer)?.[0] ?? answer,
    };
  });
  info.catch(() => engines.delete(database));
  engines.set(database, info);
  return info;
}

/** Whether `version` is `minimum` or later: "16.4" is at least "16". */
export function atLeast(version: string, minimum: string): boolean {
  const have = version.split(".").map(Number);
  const want = minimum.split(".").map(Number);
  for (const [index, wanted] of want.entries()) {
    const part = have[index] ?? 0;
    if (part !== wanted) return part > wanted;
  }
  return true;
}

/** A read (SELECT, VALUES, a WITH that changes nothing), a write, or neither (BEGIN, SET, DDL…). */
export function statementKind(sql: string): "read" | "write" | undefined {
  const word = FIRST_WORD.exec(sql)?.[1]?.toUpperCase() ?? "";
  if (word === "WITH")
    return /\b(?:insert|update|delete|merge)\b/i.test(withoutStrings(sql)) ? "write" : "read";
  if (word === "SELECT" || word === "VALUES" || word === "TABLE") return "read";
  return WRITES.has(word) ? "write" : undefined;
}

/**
 * The database's plan for a recorded query: estimated, or, for a read, run and measured inside a
 * transaction that is rolled back. `run` asks inside a transaction already open.
 */
export async function explain(
  database: Database,
  query: { sql: string; params: unknown[] },
  options: { measure?: boolean; run?: RunSql } = {},
): Promise<Plan | NoPlan> {
  const { engine, version } = await engineOf(database);
  const kind = statementKind(query.sql);
  if (!kind)
    return {
      problem: "not_explainable",
      message: "Only reads and writes have a plan: SELECT, INSERT, UPDATE and DELETE.",
    };
  const measure = options.measure === true;
  if (measure && engine === "sqlite")
    return {
      problem: "not_measurable",
      message: "SQLite estimates a plan but never measures one.",
    };
  if (measure && kind === "write")
    return {
      problem: "not_measurable",
      message: "Only reads are run to measure them: running a write would change the data.",
    };
  if (measure && LOCKING.test(withoutStrings(query.sql)))
    return {
      problem: "not_measurable",
      message:
        "A locking read is not run to measure it: it would hold its rows' locks while it runs.",
    };
  const faithful = query.params.every(isFaithful);
  const generic = !faithful && !measure && engine === "postgres" && atLeast(version, "16");
  const counts = countPositions(query.sql);
  const params = generic
    ? []
    : query.params.map((param, index) => standIn(engine, param, counts.has(index + 1)));
  const sql = explainSql(engine, query.sql.trim().replace(/;$/, ""), { measure, generic });
  const { rows } = options.run
    ? await options.run(sql, params)
    : measure
      ? await database.rolledBack(async (run) => {
          // A measured query runs for real: PostgreSQL stops it after 10 seconds.
          if (engine === "postgres") await run("SET LOCAL statement_timeout = '10s'");
          return run(sql, params);
        })
      : await database.run(sql, params);
  const output =
    engine === "sqlite"
      ? rows
      : engine === "mysql" && measure
        ? rows.map((row) => String(row[0])).join("\n")
        : rows[0]?.[0];
  return {
    engine,
    version,
    measured: measure,
    generic,
    approximate: !faithful && !generic,
    steps: readPlan(engine, measure, output),
    raw: rawText(engine, measure, output),
  };
}

function explainSql(
  engine: Engine,
  sql: string,
  { measure, generic }: { measure: boolean; generic: boolean },
): string {
  switch (engine) {
    case "postgres": {
      const options = ["FORMAT JSON", measure && "ANALYZE, BUFFERS", generic && "GENERIC_PLAN"];
      return `EXPLAIN (${options.filter(Boolean).join(", ")}) ${sql}`;
    }
    case "mysql":
      return measure ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN FORMAT=JSON ${sql}`;
    case "mariadb":
      return measure ? `ANALYZE FORMAT=JSON ${sql}` : `EXPLAIN FORMAT=JSON ${sql}`;
    case "sqlite":
      return `EXPLAIN QUERY PLAN ${sql}`;
  }
}

function readPlan(engine: Engine, measure: boolean, output: unknown): PlanStep[] {
  switch (engine) {
    case "postgres":
      return readPostgresPlan(output);
    case "mysql":
      return measure ? readMysqlTree(String(output)) : readMysqlPlan(output);
    case "mariadb":
      return readMariadbPlan(output);
    case "sqlite":
      return readSqlitePlan(output as unknown[][]);
  }
}

function rawText(engine: Engine, measure: boolean, output: unknown): string {
  if (engine === "sqlite") return sqlitePlanText(output as unknown[][]);
  if (engine === "mysql" && measure) return String(output).trimEnd();
  return JSON.stringify(parseJson(output), null, 2);
}

/** Whether a recorded parameter is the value the app sent, not a stand-in for a hidden or cut one. */
function isFaithful(param: unknown): boolean {
  if (typeof param !== "string") return true;
  return (
    param !== REDACTED &&
    !BYTES.test(param) &&
    !(param.length === CUT_LENGTH && param.endsWith("…"))
  );
}

/**
 * The recorded value as the database takes it. Dates are recorded as ISO strings, and MySQL and
 * MariaDB compare their own format. A BigInt is recorded as text, and LIMIT and OFFSET take a
 * number: Prisma 7.1 sends them as BigInts, and MySQL refuses LIMIT '1' when the driver writes the
 * values into the SQL.
 */
function standIn(engine: Engine, param: unknown, count: boolean): unknown {
  if (typeof param !== "string") return param;
  if (count && INTEGER.test(param)) return Number(param);
  const date = engine === "mysql" || engine === "mariadb" ? ISO_DATE.exec(param) : null;
  return date ? `${date[1]} ${date[2]}` : param;
}

/** The parameter positions, from 1, that give a LIMIT or an OFFSET. */
function countPositions(sql: string): Set<number> {
  const blanked = sql.replace(QUOTED, (quoted) => " ".repeat(quoted.length));
  const numbered = /\$\d+/.test(blanked);
  const positions = new Set<number>();
  let ordinal = 0;
  for (const match of blanked.matchAll(numbered ? /\$(\d+)/g : /\?/g)) {
    const position = numbered ? Number(match[1]) : ++ordinal;
    if (BEFORE_COUNT.test(blanked.slice(0, match.index))) positions.add(position);
  }
  return positions;
}

const withoutStrings = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''");
