import type { RunSql } from "../../core/index.js";
import { pickTables, split, type Table, type TableName } from "../catalog.js";
import { asNumber } from "../plan.js";

// Lists come back joined with the unit separator, as text: every driver returns text the same way.
// The statistics views are a snapshot inside a transaction; pg_stats shows an ANALYZE made in it.
const TABLES = (names: string) => `
  SELECT n.nspname, c.relname, c.reltuples::float8, pg_total_relation_size(c.oid)::float8,
    s.n_live_tup::float8, s.n_mod_since_analyze::float8,
    current_setting('autovacuum_analyze_threshold')::float8,
    current_setting('autovacuum_analyze_scale_factor')::float8,
    s.last_analyze IS NOT NULL OR s.last_autoanalyze IS NOT NULL OR EXISTS (
      SELECT 1 FROM pg_stats p WHERE p.schemaname = n.nspname AND p.tablename = c.relname
    ),
    current_schema()
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
  WHERE c.relkind IN ('r', 'p', 'm') AND c.relname IN (${names})
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;

const INDEXES = (names: string) => `
  SELECT n.nspname, t.relname, i.relname, ix.indisunique, ix.indisprimary, am.amname,
    pg_get_expr(ix.indpred, ix.indrelid),
    (SELECT string_agg(pg_get_indexdef(ix.indexrelid, k, true), E'\\x1f' ORDER BY k)
      FROM generate_series(1, ix.indnkeyatts) k),
    (SELECT string_agg(pg_get_indexdef(ix.indexrelid, k, true), E'\\x1f' ORDER BY k)
      FROM generate_series(ix.indnkeyatts + 1, ix.indnatts) k),
    0 = ANY (ix.indkey::int2[]), ix.indisvalid, pg_get_indexdef(ix.indexrelid)
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_am am ON am.oid = i.relam
  WHERE t.relname IN (${names})
  ORDER BY i.relname`;

const FOREIGN_KEYS = (names: string) => `
  SELECT n.nspname, t.relname, c.conname,
    (SELECT string_agg(a.attname, E'\\x1f' ORDER BY k.position)
      FROM unnest(c.conkey) WITH ORDINALITY k(attnum, position)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
    r.relname,
    (SELECT string_agg(a.attname, E'\\x1f' ORDER BY k.position)
      FROM unnest(c.confkey) WITH ORDINALITY k(attnum, position)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum)
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class r ON r.oid = c.confrelid
  WHERE c.contype = 'f' AND t.relname IN (${names})
  ORDER BY c.conname`;

const STATISTICS = (names: string) => `
  SELECT schemaname, tablename, statistics_name, array_to_string(attnames, E'\\x1f')
  FROM pg_stats_ext
  WHERE tablename IN (${names})`;

const COLUMNS = (names: string) => `
  SELECT n.nspname, t.relname, a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull
  FROM pg_attribute a
  JOIN pg_class t ON t.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE t.relname IN (${names}) AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum`;

/** Tables, their columns, indexes and foreign keys, from PostgreSQL's own catalog. */
export async function readPostgresCatalog(run: RunSql, asked: TableName[]): Promise<Table[]> {
  const names = [...new Set(asked.map((table) => table.name))];
  const list = names.map((_, index) => `$${index + 1}`).join(", ");
  const [tables, indexes, foreignKeys, columns, statistics] = await Promise.all(
    [TABLES, INDEXES, FOREIGN_KEYS, COLUMNS, STATISTICS].map((query) => run(query(list), names)),
  );
  const current = tables!.rows[0]?.[9] as string | undefined;
  const of = (row: unknown[], table: Table) => row[0] === table.schema && row[1] === table.name;
  const found = tables!.rows.map((row): Table => ({
    schema: String(row[0]),
    name: String(row[1]),
    ...rowEstimate(row),
    analyzed: row[8] === true,
    bytes: asNumber(row[3]),
    ...changes(row),
    columns: [],
    indexes: [],
    foreignKeys: [],
  }));
  for (const table of found) {
    table.columns = columns!.rows
      .filter((row) => of(row, table))
      .map((row) => ({ name: String(row[2]), type: String(row[3]), nullable: row[4] === true }));
    table.indexes = indexes!.rows
      .filter((row) => of(row, table))
      .map((row) => ({
        name: String(row[2]),
        columns: split(row[7]).map(unquote),
        ...(split(row[8]).length ? { include: split(row[8]).map(unquote) } : {}),
        unique: row[3] === true,
        primary: row[4] === true,
        expression: row[9] === true,
        ...(typeof row[6] === "string" ? { where: row[6] } : {}),
        method: String(row[5]),
        parts: keyParts(String(row[11])),
        ...(row[10] === false ? { valid: false } : {}),
      }));
    table.statistics = statistics!.rows
      .filter((row) => of(row, table))
      .map((row) => ({ name: String(row[2]), columns: split(row[3]) }));
    table.foreignKeys = foreignKeys!.rows
      .filter((row) => of(row, table))
      .map((row) => ({
        name: String(row[2]),
        columns: split(row[3]),
        references: { table: String(row[4]), columns: split(row[5]) },
      }));
  }
  return pickTables(asked, found, current);
}

// Autovacuum analyzes a table again once threshold + scale factor × rows of it changed.
function changes(row: unknown[]): Pick<Table, "modified" | "analyzeAfter"> {
  const modified = asNumber(row[5]);
  const threshold = asNumber(row[6]);
  const scale = asNumber(row[7]);
  const rows = Math.max(asNumber(row[2]) ?? 0, 0);
  return {
    ...(modified === undefined ? {} : { modified }),
    ...(threshold === undefined || scale === undefined
      ? {}
      : { analyzeAfter: threshold + scale * rows }),
  };
}

// reltuples is -1 until the table is first vacuumed or analyzed (PostgreSQL 14 and later); the
// statistics collector's live count stands in for it.
function rowEstimate(row: unknown[]): { rows?: number } {
  const estimate = asNumber(row[2]);
  const live = asNumber(row[4]);
  const rows = estimate !== undefined && estimate >= 0 ? estimate : live;
  return rows === undefined ? {} : { rows };
}

/** The key parts of CREATE INDEX … USING method (a, b DESC, c text_pattern_ops) …, as written. */
export function keyParts(definition: string): string[] {
  const start = definition.search(/ USING \w+ \(/);
  if (start < 0) return [];
  const open = definition.indexOf("(", start);
  const parts: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let index = open; index < definition.length; index += 1) {
    const char = definition[index];
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) {
      parts.push(definition.slice(from, index).trim());
      break;
    } else if (char === "," && depth === 1) {
      parts.push(definition.slice(from, index).trim());
      from = index + 1;
    }
  }
  return parts;
}

/** A column name as pg_get_indexdef prints it ("userId"), without its quotes. */
const unquote = (part: string) =>
  /^"(?:[^"]|"")*"$/.test(part) ? part.slice(1, -1).replace(/""/g, '"') : part;
