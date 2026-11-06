import type { Index, TableName } from "./catalog.js";
import { atLeast } from "./explain.js";
import type { Engine } from "./plan.js";
import type { Condition, Operand, SortKey } from "./statement.js";

export interface IndexColumn {
  name: string;
  descending?: boolean;
}

/** An index to add: the columns, in order, and how to write it in schema.prisma and in SQL. */
export interface IndexAdvice {
  table: TableName;
  columns: IndexColumn[];
  /** Prisma's own name for it: Table_column_column_idx. */
  name: string;
  /** The line for the model in schema.prisma. */
  prisma: string;
  sql: string;
}

export interface AdviceInput {
  engine: Engine;
  /** The engine's version, for what its indexes can do: DESC key parts only matter from MySQL 8.0 and MariaDB 10.8. */
  version?: string;
  table: TableName;
  /** Every condition of the query, on any table: the ones on this table are picked out. */
  conditions: Condition[];
  orderBy: SortKey[];
  /** The recorded parameters, to tell LIKE 'abc%' from LIKE '%abc'. */
  params: unknown[];
  existing: Index[];
  /**
   * Count a join's columns too: when another table is filtered, or this one is read again for
   * each joined row, the rows of this table are found through the join.
   */
  joins?: boolean;
}

// Casts that only relabel a text column keep its index usable.
const HARMLESS = /^::(?:text|varchar|character varying|bpchar)$/;
const MOST_COLUMNS = 4;
// PostgreSQL's limit on a name; Prisma truncates its own index names to it.
const NAME_LENGTH = 63;

/** Whether an index on the column can serve a condition that wraps it this way. */
export const usableWrapper = (wrapper: string | undefined) => !wrapper || HARMLESS.test(wrapper);

/**
 * The index this query wants on one table: equality columns first, then the sort, then one range,
 * the order that lets a B-tree index find the rows and give them sorted. Undefined when no
 * condition or sort can use one, or when an index already leads with a column it would use.
 */
export function adviseIndex(input: AdviceInput): IndexAdvice | undefined {
  const columns = wantedColumns(input);
  if (!columns.length) return undefined;
  // With equality columns, only an index that starts with one finds the rows well: one that
  // starts with a range or the sort is a poor stand-in.
  const { equalities } = wantedParts(input);
  const usable = new Set(equalities.length ? equalities : columns.map((column) => column.name));
  const served = ordered(input).some((index) => usable.has(index.columns[0] ?? ""));
  if (served) return undefined;
  return writeAdvice(input.engine, input.table, columns, input.version);
}

/**
 * The index that would give this query's rows already sorted, when ORDER BY is on this table's
 * columns and no index starts with the query's equality columns followed by the sort.
 */
export function adviseSortIndex(input: AdviceInput): IndexAdvice | undefined {
  const columns = wantedColumns(input);
  const sortAt = columns.findIndex((column) =>
    input.orderBy.some((key) => key.column?.column === column.name),
  );
  if (sortAt < 0) return undefined;
  const leading = new Set(columns.slice(0, sortAt).map((column) => column.name));
  const sort = columns
    .slice(sortAt)
    .filter((column) => input.orderBy.some((key) => key.column?.column === column.name))
    .map((column) => column.name);
  // InnoDB keeps the primary key at the end of every secondary index: (createdAt) is in the order
  // of ORDER BY createdAt, id.
  const primary = input.existing.find((index) => index.primary)?.columns ?? [];
  const innodb = input.engine === "mysql" || input.engine === "mariadb";
  const serves = (index: Index) => {
    // A prefix index holds the first characters only, so it cannot give the order.
    if (sort.some((name) => index.prefix?.[name] !== undefined)) return false;
    const columns = innodb
      ? [...index.columns, ...primary.filter((name) => !index.columns.includes(name))]
      : index.columns;
    const head = new Set(columns.slice(0, leading.size));
    const next = columns.slice(leading.size, leading.size + sort.length);
    return (
      [...leading].every((name) => head.has(name)) && sort.every((name, at) => next[at] === name)
    );
  };
  if (ordered(input).some(serves)) return undefined;
  return writeAdvice(
    input.engine,
    input.table,
    columns.slice(0, sortAt + sort.length),
    input.version,
  );
}

/** The columns an index on this table would use for the query, in the order it should list them. */
export function wantedColumns(input: AdviceInput): IndexColumn[] {
  const { equalities, sorts, ranges } = wantedParts(input);
  const ordered: IndexColumn[] = [
    ...equalities.map((name) => ({ name })),
    ...sorts,
    ...ranges.slice(0, 1).map((name) => ({ name })),
  ];
  const seen = new Set<string>();
  return ordered
    .filter((column) => !seen.has(column.name) && seen.add(column.name))
    .slice(0, MOST_COLUMNS);
}

/** The query's equality, sort and range columns on this table. */
function wantedParts(input: AdviceInput): {
  equalities: string[];
  sorts: IndexColumn[];
  ranges: string[];
} {
  const same = (table: TableName | undefined) =>
    table !== undefined && sameTable(input.engine, table, input.table);
  const filters: string[] = [];
  const joins: string[] = [];
  const ranges: string[] = [];
  for (const condition of input.conditions) {
    if (condition.alternative || condition.clause === "having") continue;
    const own = same(condition.column.table) && usableWrapper(condition.wrapper);
    const other = condition.value.kind === "column" ? condition.value.column : undefined;
    // a.x = b.y helps an index on whichever side is this table.
    if (condition.kind === "equality" && other) {
      if (own && !same(other.table)) joins.push(condition.column.column);
      else if (!own && same(other.table)) joins.push(other.column);
      continue;
    }
    if (!own) continue;
    if (condition.kind === "equality" || condition.kind === "null")
      filters.push(condition.column.column);
    else if (condition.kind === "range" || prefixPattern(condition, input.params))
      ranges.push(condition.column.column);
  }
  const equalities = [...filters, ...(input.joins === false ? [] : joins)];
  const sorted = input.orderBy.every((key) => key.column && same(key.column.table));
  const sorts = sorted
    ? input.orderBy.map((key) => ({ name: key.column!.column, descending: key.descending }))
    : [];
  return { equalities: unique(equalities), sorts, ranges };
}

/** LIKE 'abc%', which an index can read as a range, unlike LIKE '%abc'. */
export function prefixPattern(condition: Condition, params: unknown[]): boolean {
  if (condition.kind !== "pattern" || condition.operator !== "LIKE") return false;
  const pattern = patternText(condition.value, params);
  return pattern !== undefined && /^[^%_]/.test(pattern);
}

/** The pattern a LIKE compares with, as far as the SQL and the recorded values tell. */
export function patternText(value: Operand, params: unknown[]): string | undefined {
  if (value.kind === "literal") return value.text.replace(/^'|'$/g, "");
  if (value.kind === "param") {
    const param = params[value.positions[0]! - 1];
    return typeof param === "string" ? param : undefined;
  }
  if (value.kind !== "expression") return undefined;
  // '%' || $1 || '%' and CONCAT('%', ?, '%'): what is written before the first parameter.
  const before = value.text.replace(/^CONCAT\s*\(\s*/i, "").split(/\$\d+|\?/)[0] ?? "";
  const literal = /^'([^']*)'/.exec(before.trim())?.[1];
  if (literal !== undefined) return literal || undefined;
  const param = params[value.positions[0]! - 1];
  return typeof param === "string" ? param : undefined;
}

/**
 * The indexes that keep their rows in key order, the only ones that find rows by =, by a range or
 * give them sorted: B-trees, not FULLTEXT, GIN, hash or partial ones.
 */
function ordered({ existing, engine }: AdviceInput): Index[] {
  return existing.filter(
    (index) =>
      index.valid !== false &&
      !index.expression &&
      !index.where &&
      (engine === "sqlite" || index.method === undefined || /^btree$/i.test(index.method)),
  );
}

export function writeAdvice(
  engine: Engine,
  table: TableName,
  wanted: IndexColumn[],
  version = "",
): IndexAdvice {
  // A descending key part is ignored before MySQL 8.0 and MariaDB 10.8.
  const ignoresDescending =
    (engine === "mysql" && version !== "" && !atLeast(version, "8.0")) ||
    (engine === "mariadb" && version !== "" && !atLeast(version, "10.8"));
  const columns: IndexColumn[] = ignoresDescending ? wanted.map(({ name }) => ({ name })) : wanted;
  const name = `${table.name}_${columns.map((column) => column.name).join("_")}_idx`.slice(
    0,
    NAME_LENGTH,
  );
  const quote = engine === "mysql" || engine === "mariadb" ? "`" : '"';
  const quoted = (identifier: string) =>
    `${quote}${identifier.replaceAll(quote, quote + quote)}${quote}`;
  const target = [
    table.schema && engine === "postgres" ? quoted(table.schema) : "",
    quoted(table.name),
  ]
    .filter(Boolean)
    .join(".");
  const parts = columns.map(
    (column) => `${quoted(column.name)}${column.descending ? " DESC" : ""}`,
  );
  const fields = columns.map((column) =>
    column.descending ? `${column.name}(sort: Desc)` : column.name,
  );
  return {
    table,
    columns,
    name,
    prisma: `@@index([${fields.join(", ")}])`,
    sql: `CREATE INDEX ${quoted(name)} ON ${target} (${parts.join(", ")});`,
  };
}

/** Whether two names are the same table: PostgreSQL compares names exactly, the others in any case. */
export function sameTable(engine: Engine, a: TableName, b: TableName): boolean {
  const fold = (name: string) => (engine === "postgres" ? name : name.toLowerCase());
  const schemas = !a.schema || !b.schema || a.schema === b.schema;
  return schemas && fold(a.name) === fold(b.name);
}

const unique = (names: string[]) => [...new Set(names)];
