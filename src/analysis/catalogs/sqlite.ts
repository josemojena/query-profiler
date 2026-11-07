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

// The table-valued pragmas read every table's indexes in one query (SQLite 3.16 and later);
// sqlite_master is in every version, its alias sqlite_schema only from 3.33.
const TABLES = (names: string) => `
  SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names})`;

const INDEXES = (names: string) => `
  SELECT m.name, l.name, l."unique", l.origin, s.sql, x.seqno, x.name, x.key, x."desc", x.coll
  FROM sqlite_master m
  JOIN pragma_index_list(m.name) l
  JOIN pragma_index_xinfo(l.name) x
  LEFT JOIN sqlite_master s ON s.type = 'index' AND s.name = l.name
  WHERE m.type = 'table' AND m.name IN (${names}) AND x.key = 1
  ORDER BY m.name, l.name, x.seqno`;

const FOREIGN_KEYS = (names: string) => `
  SELECT m.name, f.id, f."table", f."from", f."to"
  FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
  WHERE m.type = 'table' AND m.name IN (${names})
  ORDER BY m.name, f.id, f.seq`;

const COLUMNS = (names: string) => `
  SELECT m.name, c.name, c.type, c."notnull", c.pk
  FROM sqlite_master m JOIN pragma_table_info(m.name) c
  WHERE m.type = 'table' AND m.name IN (${names})
  ORDER BY m.name, c.cid`;

// Each row's stat starts with the rows its index, or its table, holds.
const STATISTICS = "SELECT tbl, stat FROM sqlite_stat1";

/** Tables, their columns, indexes and foreign keys, from SQLite's schema and pragmas. */
export async function readSqliteCatalog(run: RunSql, asked: TableName[]): Promise<Table[]> {
  const names = [...new Set(asked.map((table) => table.name))];
  const list = names.map(() => "?").join(", ");
  const [tables, indexes, foreignKeys, columns] = await inTurn(
    [TABLES, INDEXES, FOREIGN_KEYS, COLUMNS].map((query) => () => run(query(list), names)),
  );
  const statistics = await analyzed(run);
  const found = await inTurn(
    tables!.rows.map(([tableName]) => async (): Promise<Table> => {
      const name = String(tableName);
      const own = (rows: unknown[][]) => rows.filter((row) => row[0] === name);
      const tableColumns = own(columns!.rows);
      const stat = statistics.get(name);
      return {
        schema: "main",
        name,
        rows: stat ?? (await countRows(run, name)),
        analyzed: stat !== undefined,
        columns: tableColumns.map((row) => ({
          name: String(row[1]),
          type: String(row[2]),
          nullable: Number(row[3]) === 0 && Number(row[4]) === 0,
        })),
        indexes: [
          ...rowidKey(tableColumns, own(indexes!.rows)),
          ...groupIndexes(own(indexes!.rows)),
        ],
        foreignKeys: foreignKeysOf(own(foreignKeys!.rows)),
      };
    }),
  );
  return pickTables(asked, found, "main");
}

function groupIndexes(rows: unknown[][]): Index[] {
  const byName = new Map<string, unknown[][]>();
  for (const row of rows) byName.set(String(row[1]), [...(byName.get(String(row[1])) ?? []), row]);
  return [...byName.values()].map((parts) => {
    const [first] = parts;
    const sql = typeof first![4] === "string" ? first![4] : "";
    // A partial index keeps its condition only in the CREATE INDEX statement.
    const where = /\bWHERE\b([\s\S]*)$/i.exec(sql)?.[1]?.trim();
    return {
      name: String(first![1]),
      // An expression part has no column name (cid -2).
      columns: parts.map((row) => (row[6] === null ? EXPRESSION : String(row[6]))),
      unique: Number(first![2]) === 1,
      primary: first![3] === "pk",
      expression: parts.some((row) => row[6] === null),
      parts: parts.map(
        (row) =>
          `${row[6] === null ? EXPRESSION : String(row[6])}${row[9] && row[9] !== "BINARY" ? ` COLLATE ${String(row[9])}` : ""}${Number(row[8]) === 1 ? " DESC" : ""}`,
      ),
      ...(where ? { where } : {}),
    };
  });
}

// A rowid table's INTEGER PRIMARY KEY is the rowid itself, and has no index of its own to list.
function rowidKey(columns: unknown[][], indexes: unknown[][]): Index[] {
  const key = columns.filter((row) => Number(row[4]) > 0);
  const listed = indexes.some((row) => row[3] === "pk");
  if (key.length !== 1 || listed || !/^integer$/i.test(String(key[0]![2]))) return [];
  return [
    {
      name: "INTEGER PRIMARY KEY",
      columns: [String(key[0]![1])],
      unique: true,
      primary: true,
      expression: false,
    },
  ];
}

function foreignKeysOf(rows: unknown[][]): Table["foreignKeys"] {
  const byId = new Map<number, unknown[][]>();
  for (const row of rows) byId.set(Number(row[1]), [...(byId.get(Number(row[1])) ?? []), row]);
  return [...byId.values()].map((parts) => ({
    columns: parts.map((row) => String(row[3])),
    references: {
      table: String(parts[0]![2]),
      // No "to" column means the parent's primary key.
      columns: parts.map((row) => (row[4] === null ? "" : String(row[4]))).filter(Boolean),
    },
  }));
}

// The row count ANALYZE wrote into sqlite_stat1, for the tables it has seen. Each index has a row,
// and a partial index's counts only its own rows: the largest is the table's.
async function analyzed(run: RunSql): Promise<Map<string, number>> {
  const exists = await run("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'");
  if (!exists.rows.length) return new Map();
  const { rows } = await run(STATISTICS);
  const counts = new Map<string, number>();
  for (const [table, stat] of rows) {
    const count = asNumber(String(stat).split(" ")[0]);
    if (count !== undefined)
      counts.set(String(table), Math.max(count, counts.get(String(table)) ?? 0));
  }
  return counts;
}

// Counting stops at a million rows: enough to tell a small table from a big one.
async function countRows(run: RunSql, table: string): Promise<number | undefined> {
  const quoted = `"${table.replace(/"/g, '""')}"`;
  const { rows } = await run(`SELECT COUNT(*) FROM (SELECT 1 FROM ${quoted} LIMIT 1000000)`);
  return asNumber(rows[0]?.[0]);
}
