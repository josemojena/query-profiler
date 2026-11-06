import { atLeast } from "../explain.js";
import type { Engine } from "../plan.js";
import type { Analyzed } from "./subjects.js";

/** What to change, in words, and when there is one, the line for schema.prisma and the SQL. */
export interface Fix {
  kind: string;
  text: string;
  /** The index it adds, by name: what a trial of it asks for. */
  index?: string;
  prisma?: string;
  sql?: string;
}

const RAW_MIGRATION =
  "schema.prisma cannot declare it: add it to a migration created with prisma migrate dev --create-only.";

// Functions each engine accepts in an index because they always give the same result for the same
// input; MariaDB indexes an expression only through a generated column.
const INDEXABLE: Record<Exclude<Engine, "mariadb">, Set<string>> = {
  postgres: new Set([
    "lower",
    "upper",
    "trim",
    "btrim",
    "ltrim",
    "rtrim",
    "abs",
    "length",
    "char_length",
    "octet_length",
    "md5",
    "jsonb_extract_path",
    "jsonb_extract_path_text",
  ]),
  mysql: new Set([
    "lower",
    "upper",
    "trim",
    "abs",
    "length",
    "char_length",
    "date",
    "year",
    "month",
    "day",
    "json_extract",
    "json_unquote",
  ]),
  sqlite: new Set([
    "lower",
    "upper",
    "trim",
    "ltrim",
    "rtrim",
    "abs",
    "length",
    "substr",
    "json_extract",
    "date",
    "coalesce",
    "ifnull",
  ]),
};

/** The fix a rule names, written for this subject and engine. */
export function fixFor(
  kind: string | undefined,
  subject: Analyzed,
  engine: Engine,
  version = "",
): Fix | undefined {
  const quote = engine === "mysql" || engine === "mariadb" ? "`" : '"';
  const quoted = (name: string) => `${quote}${name.replaceAll(quote, quote + quote)}${quote}`;
  const table = subject.table?.name ?? "";
  const column = subject.column ?? "";
  switch (kind) {
    case "index": {
      const advice = subject.advice;
      if (!advice) return undefined;
      return {
        kind,
        text: `Add an index on ${advice.columns.map((part) => part.name).join(", ")} to the ${table} model, then run prisma migrate dev.`,
        index: advice.name,
        prisma: advice.prisma,
        sql: advice.sql,
      };
    }
    case "analyze":
      return {
        kind,
        text: "Gather fresh statistics on the table, so the plan counts rows right.",
        sql:
          engine === "mysql" || engine === "mariadb"
            ? `ANALYZE TABLE ${quoted(table)};`
            : `ANALYZE ${quoted(table)};`,
      };
    case "trigram": {
      const name = `${table}_${column}_trgm_idx`;
      return {
        kind,
        text: "A trigram index finds text anywhere in the column, % first or case-insensitive. It needs the pg_trgm extension: create it first, in a migration made with prisma migrate dev --create-only.",
        prisma: `@@index([${column}(ops: raw("gin_trgm_ops"))], type: Gin, map: "${name}")`,
        sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE INDEX ${quoted(name)} ON ${quoted(table)} USING gin (${quoted(column)} gin_trgm_ops);`,
      };
    }
    case "fulltext":
      return {
        kind,
        text: "A FULLTEXT index finds whole words anywhere in the column, not parts of words: search it with Prisma's search filter instead of contains.",
        prisma: `@@fulltext([${column}])`,
        sql: `CREATE FULLTEXT INDEX ${quoted(`${table}_${column}_idx`)} ON ${quoted(table)} (${quoted(column)});`,
      };
    case "full-text":
      return {
        kind,
        text: `An FTS5 virtual table finds words anywhere in the text. ${RAW_MIGRATION}`,
      };
    case "expression-index": {
      const expression = subject.values.expression;
      if (typeof expression !== "string") return undefined;
      const name = /^(\w+)\(/.exec(expression)?.[1]?.toLowerCase() ?? "";
      const functional = engine === "mysql" ? atLeast(version || "8.0.13", "8.0.13") : true;
      if (engine === "mariadb" || !functional)
        return {
          kind,
          text: `Index ${expression} through a generated column: add one for it, index the column and compare that. ${RAW_MIGRATION}`,
        };
      if (!INDEXABLE[engine].has(name))
        return {
          kind,
          text: `Compare the column itself; or, if ${name}() always gives the same result for the same input, index ${expression}. ${RAW_MIGRATION}`,
        };
      return {
        kind,
        text: `Index the expression itself. ${RAW_MIGRATION}`,
        sql: `CREATE INDEX ${quoted(`${table}_${column}_${name}_idx`)} ON ${quoted(table)} ((${expression}));`,
      };
    }
    case "keyset":
      return {
        kind,
        text: "Page with a cursor instead of skip: findMany({ cursor: { id: lastId }, skip: 1, take }) reads on from the last row through the index.",
      };
    case "not-exists":
      return {
        kind,
        text: "Write it as NOT EXISTS (SELECT 1 FROM … WHERE …), which NULLs do not empty.",
      };
    case "join-strategy":
      return {
        kind,
        text:
          engine === "postgres"
            ? 'Load the relation in the same query with relationLoadStrategy: "join" (the relationJoins preview feature), or page the parent rows with take so each list of ids stays short.'
            : "Page the parent rows with take, so each list of ids stays short.",
      };
    case "optimize":
      return {
        kind,
        text: "Run PRAGMA optimize from the app when a connection closes, or every few hours: it gathers statistics where they help. ANALYZE on a development database makes SQLite plan for tables that small.",
        sql: "PRAGMA optimize;",
      };
    case "sort-memory":
      return {
        kind,
        text:
          engine === "postgres"
            ? "An index that gives the rows in order avoids the sort; otherwise raise work_mem for this query."
            : "An index that gives the rows in order avoids the sort; otherwise the sort needs more memory.",
      };
    case "drop-index": {
      const index = String(subject.values.index ?? "");
      return {
        kind,
        text: "Remove it, and its @@index line in schema.prisma if it has one.",
        sql:
          engine === "mysql" || engine === "mariadb"
            ? `DROP INDEX ${quoted(index)} ON ${quoted(table)};`
            : `DROP INDEX ${quoted(index)};`,
      };
    }
    default:
      return undefined;
  }
}
