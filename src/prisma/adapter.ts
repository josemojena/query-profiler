import { recordStatement, newTransactionId } from "./statement.js";

interface SqlQuery {
  sql: string;
  args: unknown[];
}

interface Queryable {
  queryRaw(query: SqlQuery): Promise<unknown>;
  executeRaw(query: SqlQuery): Promise<number>;
}

interface Transaction extends Queryable {
  readonly options?: { usePhantomQuery?: boolean };
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

interface Adapter extends Queryable {
  startTransaction(...args: unknown[]): Promise<Transaction>;
}

export interface AdapterFactory {
  connect(): Promise<Adapter>;
}

/** Wraps a Prisma 7 driver adapter factory so every statement Prisma sends is recorded. */
export function profileAdapter<T extends AdapterFactory>(factory: T): T {
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
  return overriding(adapter, {
    ...queries(adapter, undefined),
    startTransaction: async (...args: unknown[]) => {
      const txId = newTransactionId();
      const transaction = await recordStatement("BEGIN", [], txId, () =>
        adapter.startTransaction(...args),
      );
      // Without phantom queries Prisma sends COMMIT/ROLLBACK as SQL itself, and these only release the connection.
      if (!transaction.options?.usePhantomQuery)
        return overriding(transaction, queries(transaction, txId));
      return overriding(transaction, {
        ...queries(transaction, txId),
        commit: () => recordStatement("COMMIT", [], txId, () => transaction.commit()),
        rollback: () => recordStatement("ROLLBACK", [], txId, () => transaction.rollback()),
      });
    },
  });
}

function queries(target: Queryable, txId: string | undefined): Queryable {
  return {
    queryRaw: (query) => recordStatement(query.sql, query.args, txId, () => target.queryRaw(query)),
    executeRaw: (query) =>
      recordStatement(query.sql, query.args, txId, () => target.executeRaw(query)),
  };
}

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
