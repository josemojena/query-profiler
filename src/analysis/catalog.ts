import type { RunSql } from "../core/index.js";
import { readMysqlCatalog } from "./catalogs/mysql.js";
import { readPostgresCatalog } from "./catalogs/postgres.js";
import { readSqliteCatalog } from "./catalogs/sqlite.js";
import type { Engine } from "./plan.js";

export interface Index {
  name: string;
  /** Key parts in order: a column's name, or an expression's text. */
  columns: string[];
  /** Columns stored in the index without being part of its key (PostgreSQL's INCLUDE). */
  include?: string[];
  unique: boolean;
  primary: boolean;
  /** Some key part is an expression, such as lower(email). */
  expression: boolean;
  /** Columns indexed by their first characters only (MySQL and MariaDB prefix indexes). */
  prefix?: Record<string, number>;
  /** The condition of a partial index. */
  where?: string;
  /** btree, hash, gin… (PostgreSQL), BTREE, FULLTEXT… (MySQL). */
  method?: string;
  /**
   * Each key part as the database defines it, with its direction, collation or operator class:
   * two indexes are the same only when these are.
   */
  parts?: string[];
  /** False for an index PostgreSQL could not finish building: it is kept, and never used. */
  valid?: boolean;
}

export interface ForeignKey {
  name?: string;
  columns: string[];
  references: { table: string; columns: string[] };
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

export interface Table {
  schema?: string;
  name: string;
  /** The database's own count or estimate of its rows; undefined when it has none. */
  rows?: number;
  /** The database has statistics on its data to plan with (ANALYZE). */
  analyzed: boolean;
  bytes?: number;
  /** Rows changed since its statistics were last gathered (PostgreSQL). */
  modified?: number;
  /** The changes after which autovacuum gathers its statistics again (PostgreSQL). */
  analyzeAfter?: number;
  /** Extended statistics: columns the planner knows to be related (PostgreSQL's CREATE STATISTICS). */
  statistics?: { name: string; columns: string[] }[];
  columns: Column[];
  indexes: Index[];
  foreignKeys: ForeignKey[];
}

export interface TableName {
  schema?: string;
  name: string;
}

/**
 * What the database knows about these tables; a table it does not have is left out. `run` may be a
 * rolled back transaction's, to see an index created in it.
 */
export function readCatalog(run: RunSql, engine: Engine, tables: TableName[]): Promise<Table[]> {
  const unique = [...new Map(tables.map((table) => [key(table), table])).values()];
  if (!unique.length) return Promise.resolve([]);
  switch (engine) {
    case "postgres":
      return readPostgresCatalog(run, unique);
    case "mysql":
    case "mariadb":
      return readMysqlCatalog(run, unique);
    case "sqlite":
      return readSqliteCatalog(run, unique);
  }
}

const key = (table: TableName) => `${table.schema ?? ""}.${table.name}`;

/**
 * Runs the steps one after another. `run` may be one transaction's, on one connection, which takes
 * one query at a time: pg queues the others today, and stops doing so in its next major version.
 */
export async function inTurn<T>(steps: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (const step of steps) results.push(await step());
  return results;
}

/** For each table asked for, the one found in its schema, or else in the connection's own. */
export function pickTables<T extends { schema?: string; name: string }>(
  asked: TableName[],
  found: T[],
  current: string | undefined,
): T[] {
  return asked.flatMap((table) => {
    const named = found.filter((candidate) => candidate.name === table.name);
    const match =
      named.find((candidate) => candidate.schema === (table.schema ?? current)) ??
      (table.schema ? undefined : named[0]);
    return match ? [match] : [];
  });
}

/** A key part that is an expression the catalog does not spell out. */
export const EXPRESSION = "(expression)";

/** One row per item of a list the database joined with this separator. */
export const SEPARATOR = "\u001f";
export const split = (value: unknown): string[] =>
  typeof value === "string" && value ? value.split(SEPARATOR) : [];
