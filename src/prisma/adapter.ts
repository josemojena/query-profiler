import {
  enabled,
  registerDatabase,
  runInScope,
  type DatabaseReference,
  type Provider,
  type Rows,
  type RunSql,
} from "../core/index.js";
import { recordStatement, newTransactionId } from "./statement.js";

interface SqlQuery {
  sql: string;
  args: unknown[];
  argTypes?: unknown[];
}

interface ResultSet {
  columnNames: string[];
  rows: unknown[][];
}

interface Queryable {
  queryRaw(query: SqlQuery): Promise<ResultSet>;
  executeRaw(query: SqlQuery): Promise<number>;
}

interface Transaction extends Queryable {
  readonly options?: { usePhantomQuery?: boolean };
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface Adapter extends Queryable {
  readonly provider: string;
  startTransaction(...args: unknown[]): Promise<Transaction>;
  dispose(): Promise<void>;
}

export interface AdapterFactory {
  connect(): Promise<Adapter>;
}

const UNTYPED = { scalarType: "unknown", arity: "scalar" };
const PROVIDERS: string[] = ["postgres", "mysql", "sqlite"] satisfies Provider[];

/** Wraps a Prisma 7 driver adapter factory so every statement Prisma sends is recorded; returns it untouched outside development. */
export function profileAdapter<T extends AdapterFactory>(factory: T): T {
  if (!enabled()) return factory;
  const connected = (adapter: Adapter) => profileConnection(adapter);
  return overriding(factory, {
    connect: async () => connected(await factory.connect()),
    connectToShadowDb: async () =>
      connected(
        await (factory as unknown as { connectToShadowDb(): Promise<Adapter> }).connectToShadowDb(),
      ),
  });
}

function profileConnection(adapter: Adapter): Adapter {
  const database = PROVIDERS.includes(adapter.provider)
    ? registerDatabase({
        provider: adapter.provider as Provider,
        run: runner(adapter),
        rolledBack: (fn) => rolledBack(adapter, fn),
      })
    : undefined;
  const reference = database && { id: database.id, provider: database.provider };
  return overriding(adapter, {
    ...queries(adapter, undefined, reference),
    startTransaction: async (...args: unknown[]) => {
      const txId = newTransactionId();
      const transaction = await recordStatement(
        { sql: "BEGIN", params: [], txId, database: reference },
        () => adapter.startTransaction(...args),
      );
      // Without phantom queries Prisma sends COMMIT/ROLLBACK as SQL itself, and these only release the connection.
      if (!transaction.options?.usePhantomQuery)
        return overriding(transaction, queries(transaction, txId, reference));
      const control = (sql: string) => ({ sql, params: [], txId, database: reference });
      return overriding(transaction, {
        ...queries(transaction, txId, reference),
        commit: () => recordStatement(control("COMMIT"), () => transaction.commit()),
        rollback: () => recordStatement(control("ROLLBACK"), () => transaction.rollback()),
      });
    },
    dispose: () => {
      database?.unregister();
      return adapter.dispose();
    },
  });
}

function queries(
  target: Queryable,
  txId: string | undefined,
  database: DatabaseReference | undefined,
): Queryable {
  const statement = (query: SqlQuery) => ({ sql: query.sql, params: query.args, txId, database });
  return {
    queryRaw: (query) => recordStatement(statement(query), () => target.queryRaw(query)),
    executeRaw: (query) => recordStatement(statement(query), () => target.executeRaw(query)),
  };
}

const sqlQuery = (sql: string, params: unknown[] = []): SqlQuery => ({
  sql,
  args: params,
  argTypes: params.map(() => UNTYPED),
});

// What the profiler asks is never one of the app's queries, even inside a request: a profiled pg
// pool under the adapter would record it otherwise.
const unrecorded = <T>(fn: () => Promise<T>) => runInScope({ recording: true }, fn);

const runner =
  (target: Queryable): RunSql =>
  (sql, params) =>
    unrecorded(async () => {
      const result = await target.queryRaw(sqlQuery(sql, params));
      return { columns: result.columnNames, rows: result.rows } satisfies Rows;
    });

const rolledBack = <T>(adapter: Adapter, fn: (run: RunSql) => Promise<T>): Promise<T> =>
  unrecorded(async () => {
    const transaction = await adapter.startTransaction();
    try {
      return await fn(runner(transaction));
    } finally {
      try {
        if (!transaction.options?.usePhantomQuery)
          await transaction.executeRaw(sqlQuery("ROLLBACK"));
      } finally {
        await transaction.rollback();
      }
    }
  });

// A Proxy keeps everything else the adapter exposes (provider, options, savepoints…).
function overriding<T extends object>(target: T, methods: object): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      if (typeof key === "string" && key in methods && key in object)
        return (methods as Record<string, unknown>)[key];
      const value: unknown = Reflect.get(object, key, receiver);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}
