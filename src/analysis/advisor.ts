import type { Collation, Column, Index, Table, TableName } from "./catalog.js";
import { atLeast } from "./explain.js";
import type { Engine } from "./plan.js";
import { DATABASE_NAMES, type PrismaNames } from "./schema.js";
import type { Condition, Operand, SortKey } from "./statement.js";

export interface IndexColumn {
  name: string;
  descending?: boolean;
}

/** An index to add: the columns, in order, and how to write it in SQL; prismaIndex() writes its schema line. */
export interface IndexAdvice {
  table: TableName;
  columns: IndexColumn[];
  /** Prisma's own name for it: Table_column_column_idx. */
  name: string;
  sql: string;
}

/** The index's line for its model in schema.prisma, with the schema's names for the columns. */
export function prismaIndex(
  advice: Pick<IndexAdvice, "table" | "columns">,
  names: PrismaNames = DATABASE_NAMES,
): string {
  const fields = advice.columns.map(
    (column) =>
      `${names.field(advice.table.name, column.name)}${column.descending ? "(sort: Desc)" : ""}`,
  );
  return `@@index([${fields.join(", ")}])`;
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
  /** The table's columns, for how each sorts: LIKE reads a range only of an index in a fitting order. */
  columns?: Column[];
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
// The libc locales in which PostgreSQL sorts text by its bytes.
const BYTE_ORDER = /^(?:C|POSIX)$/;

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

/**
 * The index that would give this query's rows already grouped: the columns an equality fixes, then
 * the GROUP BY columns in their order. Undefined when an index already starts that way.
 */
export function adviseGroupIndex(
  input: AdviceInput & { groupBy: string[] },
): IndexAdvice | undefined {
  const { equalities } = wantedParts({ ...input, orderBy: [], joins: false });
  const leading = equalities.filter((name) => !input.groupBy.includes(name));
  if (!input.groupBy.length || leading.length + input.groupBy.length > MOST_COLUMNS)
    return undefined;
  const finds = (index: Index) => {
    const head = new Set(index.columns.slice(0, leading.length));
    return leading.every((name) => head.has(name));
  };
  const serves = (index: Index) => {
    // A prefix index holds the first characters only, so it cannot give the groups.
    if (input.groupBy.some((name) => index.prefix?.[name] !== undefined)) return false;
    const next = index.columns.slice(leading.length, leading.length + input.groupBy.length);
    return finds(index) && input.groupBy.every((name, at) => next[at] === name);
  };
  // MySQL keeps an index that already finds the equality's rows, and groups them in a temporary
  // table, even when another index would give them grouped.
  const found = leading.length > 0 && ordered(input).some(finds);
  if (found || ordered(input).some(serves)) return undefined;
  return writeAdvice(
    input.engine,
    input.table,
    [...leading, ...input.groupBy].map((name) => ({ name })),
    input.version,
  );
}

/**
 * The index that looks up every column an equality fixes before the one range, when the index a
 * read uses stops at a range before such a column. Undefined when an index already starts with
 * all of them.
 */
export function adviseKeyOrder(input: AdviceInput): IndexAdvice | undefined {
  const { equalities } = wantedParts(input);
  const columns = wantedColumns(input);
  const fixed = new Set(equalities);
  const startsWithAll = (index: Index) =>
    index.columns.length >= fixed.size &&
    index.columns.slice(0, fixed.size).every((name) => fixed.has(name));
  if (!fixed.size || ordered(input).some(startsWithAll)) return undefined;
  return writeAdvice(input.engine, input.table, columns, input.version);
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
    const column = input.columns?.find((each) => each.name === condition.column.column);
    if (condition.kind === "equality" || condition.kind === "null")
      filters.push(condition.column.column);
    else if (
      condition.kind === "range" ||
      (prefixPattern(condition, input.params) && plainServesLike(input.engine, column))
    )
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
 * Whether text in this collation sorts by a language's rules: PostgreSQL's ICU, or libc in a locale
 * other than C and POSIX. False when unknown, and for the builtin provider, which sorts by code point.
 */
export function sortsByLanguage(collation: Collation | undefined): boolean {
  if (collation?.provider === "icu") return true;
  return (
    collation?.provider === "libc" &&
    collation.locale !== undefined &&
    !BYTE_ORDER.test(collation.locale)
  );
}

/**
 * Whether a plain index on the column, as writeAdvice() writes it, reads LIKE 'abc%' as a range.
 * SQLite's LIKE ignores case, unlike its plain indexes; a PostgreSQL B-tree finds a fixed start only
 * when it sorts by bytes or code points.
 */
function plainServesLike(engine: Engine, column: Column | undefined): boolean {
  if (engine === "sqlite") return false;
  return engine !== "postgres" || !sortsByLanguage(column?.collation);
}

/** Whether an index that leads with the column reads LIKE 'abc%' on it as a range. */
function servesLike(engine: Engine, index: Index, column: Column | undefined): boolean {
  if (engine === "sqlite") return /^nocase$/i.test(index.collations?.[0]?.name ?? "");
  if (plainServesLike(engine, column)) return true;
  return (
    /_pattern_ops$/.test(index.operatorClasses?.[0] ?? "") ||
    !sortsByLanguage(index.collations?.[0])
  );
}

/**
 * A LIKE 'abc%' that a plain index cannot read as a range, and no index of its table serves: with
 * the column's type and the index that leads with the column, when one does. Undefined for any
 * other condition.
 */
export function unservedPrefix(
  engine: Engine,
  condition: Condition,
  params: unknown[],
  table: Pick<Table, "columns" | "indexes">,
): { column: string; type?: string; leading?: Index } | undefined {
  if (!prefixPattern(condition, params) || !usableWrapper(condition.wrapper)) return undefined;
  const name = condition.column.column;
  const column = table.columns.find((each) => each.name === name);
  if (plainServesLike(engine, column)) return undefined;
  const leading = ordered({ engine, existing: table.indexes }).filter(
    (index) => index.columns[0] === name,
  );
  if (leading.some((index) => servesLike(engine, index, column))) return undefined;
  return {
    column: name,
    ...(column ? { type: column.type } : {}),
    ...(leading[0] ? { leading: leading[0] } : {}),
  };
}

/** The operator class that lets a PostgreSQL B-tree serve LIKE on a column of this type. */
export function patternClass(type = ""): string {
  if (/^character varying\b/.test(type)) return "varchar_pattern_ops";
  return /^(?:character|bpchar)\b/.test(type) ? "bpchar_pattern_ops" : "text_pattern_ops";
}

/**
 * The indexes that keep their rows in key order, the only ones that find rows by =, by a range or
 * give them sorted: B-trees, not FULLTEXT, GIN, hash or partial ones, nor one the optimizer may
 * not use.
 */
function ordered({ existing, engine }: Pick<AdviceInput, "engine" | "existing">): Index[] {
  return existing.filter(
    (index) =>
      index.valid !== false &&
      index.visible !== false &&
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
  return {
    table,
    columns,
    name,
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
