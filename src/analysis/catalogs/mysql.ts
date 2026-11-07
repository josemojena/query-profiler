import type { RunSql } from "../../core/index.js";
import {
  EXPRESSION,
  pickTables,
  type Index,
  type Table,
  type TableName,
  inTurn,
} from "../catalog.js";
import { asNumber } from "../plan.js";

// Only columns MySQL and MariaDB both have: MariaDB has no EXPRESSION in STATISTICS.
const TABLES = (names: string) => `
  SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH, DATABASE()
  FROM information_schema.TABLES
  WHERE TABLE_NAME IN (${names}) AND TABLE_TYPE = 'BASE TABLE'`;

const INDEXES = (names: string) => `
  SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE, SUB_PART,
    COLLATION
  FROM information_schema.STATISTICS
  WHERE TABLE_NAME IN (${names})
  ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;

const FOREIGN_KEYS = (names: string) => `
  SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
    REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_NAME IN (${names}) AND REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`;

const COLUMNS = (names: string) => `
  SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
  FROM information_schema.COLUMNS
  WHERE TABLE_NAME IN (${names})
  ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;

/** Tables, their columns, indexes and foreign keys, from MySQL's or MariaDB's information_schema. */
export async function readMysqlCatalog(run: RunSql, asked: TableName[]): Promise<Table[]> {
  const names = [...new Set(asked.map((table) => table.name))];
  const list = names.map(() => "?").join(", ");
  const [tables, indexes, foreignKeys, columns] = await inTurn(
    [TABLES, INDEXES, FOREIGN_KEYS, COLUMNS].map((query) => () => run(query(list), names)),
  );
  const current = tables!.rows[0]?.[4] as string | undefined;
  const of = (row: unknown[], table: Table) => row[0] === table.schema && row[1] === table.name;
  const found = tables!.rows.map((row): Table => {
    const rows = asNumber(row[2]);
    return {
      schema: String(row[0]),
      name: String(row[1]),
      ...(rows === undefined ? {} : { rows }),
      // InnoDB keeps persistent statistics on every table from the start.
      analyzed: true,
      bytes: asNumber(row[3]),
      columns: [],
      indexes: [],
      foreignKeys: [],
    };
  });
  for (const table of found) {
    table.columns = columns!.rows
      .filter((row) => of(row, table))
      .map((row) => ({ name: String(row[2]), type: String(row[3]), nullable: row[4] === "YES" }));
    table.indexes = groupIndexes(indexes!.rows.filter((row) => of(row, table)));
    table.foreignKeys = [
      ...group(
        foreignKeys!.rows.filter((row) => of(row, table)),
        (row) => String(row[2]),
      ).values(),
    ].map((parts) => ({
      name: String(parts[0]![2]),
      columns: parts.map((row) => String(row[3])),
      references: { table: String(parts[0]![4]), columns: parts.map((row) => String(row[5])) },
    }));
  }
  const picked = pickTables(asked, found, current);
  // TABLE_ROWS is an estimate MySQL caches for up to a day: a table seeded since looks empty.
  await inTurn(picked.map((table) => () => countRows(run, table)));
  return picked;
}

// Counting stops at a million rows: enough to tell a small table from a big one.
async function countRows(run: RunSql, table: Table): Promise<void> {
  const quoted = (name: string) => `\`${name.replaceAll("`", "``")}\``;
  const target = `${table.schema ? `${quoted(table.schema)}.` : ""}${quoted(table.name)}`;
  const counted = await run(
    `SELECT COUNT(*) FROM (SELECT 1 FROM ${target} LIMIT 1000000) counted`,
  ).catch(() => undefined);
  const rows = asNumber(counted?.rows[0]?.[0]);
  if (rows !== undefined) table.rows = rows;
}

function groupIndexes(rows: unknown[][]): Index[] {
  return [...group(rows, (row) => String(row[2])).values()].map((parts) => {
    const [first] = parts;
    const name = String(first![2]);
    const prefixed = parts.filter((row) => row[4] !== null && asNumber(row[6]) !== undefined);
    return {
      name,
      // A functional key part (MySQL 8.0.13 and later) has no column name.
      columns: parts.map((row) => (row[4] === null ? EXPRESSION : String(row[4]))),
      unique: Number(first![3]) === 0,
      primary: name === "PRIMARY",
      expression: parts.some((row) => row[4] === null),
      ...(prefixed.length
        ? { prefix: Object.fromEntries(prefixed.map((row) => [String(row[4]), asNumber(row[6])!])) }
        : {}),
      method: String(first![5]),
      // COLLATION is D for a descending key part.
      parts: parts.map(
        (row) =>
          `${row[4] === null ? EXPRESSION : String(row[4])}${row[6] ? `(${String(row[6])})` : ""}${row[7] === "D" ? " DESC" : ""}`,
      ),
    };
  });
}

function group(rows: unknown[][], key: (row: unknown[]) => string): Map<string, unknown[][]> {
  const groups = new Map<string, unknown[][]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}
