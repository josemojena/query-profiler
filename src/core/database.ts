import type { DatabaseReference, Provider } from "./profile.js";
import { state } from "./state.js";

export interface Rows {
  columns: string[];
  rows: unknown[][];
}

export type RunSql = (sql: string, params?: unknown[]) => Promise<Rows>;

/** A connection the profiler asks about the app's queries. What it runs there is never recorded. */
export interface Database {
  readonly id: string;
  readonly provider: Provider;
  readonly run: RunSql;
  /** Runs `fn` inside a transaction that is always rolled back. */
  rolledBack<T>(fn: (run: RunSql) => Promise<T>): Promise<T>;
}

/** Makes a connection available to ask about the queries it runs; `unregister` removes it. */
export function registerDatabase(database: Omit<Database, "id">): Database & {
  unregister(): void;
} {
  const current = state();
  const databases = (current.databases ??= new Map());
  current.databaseCount = (current.databaseCount ?? 0) + 1;
  const registered = { ...database, id: `${database.provider}#${current.databaseCount}` };
  databases.set(registered.id, registered);
  return { ...registered, unregister: () => databases.delete(registered.id) };
}

/**
 * The connection that ran a query. A profile from another process names one of that process's: the
 * first here with the same provider stands in for it.
 */
export function findDatabase(reference: DatabaseReference | undefined): Database | undefined {
  const databases = state().databases;
  if (!reference || !databases) return undefined;
  return (
    databases.get(reference.id) ??
    [...databases.values()].find((database) => database.provider === reference.provider)
  );
}
