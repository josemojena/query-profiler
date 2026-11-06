import type { Engine } from "../plan.js";
import type { Analyzed } from "./subjects.js";

/** What to change, in words, and when there is one, the line for schema.prisma and the SQL. */
export interface Fix {
  kind: string;
  text: string;
  prisma?: string;
  sql?: string;
}

const RAW_MIGRATION =
  "schema.prisma cannot declare it: add it to a migration created with prisma migrate dev --create-only.";

/** The fix a rule names, written for this subject and engine. */
export function fixFor(
  kind: string | undefined,
  subject: Analyzed,
  engine: Engine,
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
    case "trigram":
      return {
        kind,
        text: "A trigram index finds text anywhere in the column, % first or case-insensitive. It needs the pg_trgm extension.",
        prisma: `@@index([${column}(ops: raw("gin_trgm_ops"))], type: Gin)`,
        sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE INDEX ${quoted(`${table}_${column}_trgm_idx`)} ON ${quoted(table)} USING gin (${quoted(column)} gin_trgm_ops);`,
      };
    case "fulltext":
      return {
        kind,
        text: "A FULLTEXT index finds words anywhere in the column; search it with Prisma's search filter instead of contains.",
        prisma: `@@fulltext([${column}])`,
        sql: `CREATE FULLTEXT INDEX ${quoted(`${table}_${column}_idx`)} ON ${quoted(table)} (${quoted(column)});`,
      };
    case "full-text":
      return {
        kind,
        text: `An FTS5 virtual table finds words anywhere in the text. ${RAW_MIGRATION}`,
      };
    case "expression-index": {
      const expression = expressionOf(subject.values.wrapper, quoted(column));
      if (!expression) return undefined;
      if (engine === "mariadb")
        return {
          kind,
          text: `MariaDB indexes an expression through a generated column: add one for ${expression} and index it. ${RAW_MIGRATION}`,
        };
      return {
        kind,
        text: `Index the expression itself. ${RAW_MIGRATION}`,
        sql: `CREATE INDEX ${quoted(`${table}_${column}_expr_idx`)} ON ${quoted(table)} ((${expression}));`,
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
      return { kind, text: "Page the parent rows with take, so each list of ids stays short." };
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

// lower() wraps as lower("col"); a cast ::date as ("col")::date; COLLATE x as "col" COLLATE x.
function expressionOf(wrapper: unknown, column: string): string | undefined {
  if (typeof wrapper !== "string") return undefined;
  const call = /^(\w+)\(\)$/.exec(wrapper)?.[1];
  if (call) return `${call}(${column})`;
  if (wrapper.startsWith("::")) return `(${column})${wrapper}`;
  if (wrapper.startsWith("cast as ")) return `CAST(${column} AS ${wrapper.slice(8)})`;
  return undefined;
}
