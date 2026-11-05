import { captureOrigin, currentScope, enabled, runInScope } from "../core/index.js";
import type { Pool, PoolClient } from "pg";
import { beginStatement } from "./statement.js";

type QueryFn = (...args: unknown[]) => unknown;
type Client = PoolClient & { [PATCHED]?: true; [TX]?: string };

const PATCHED = Symbol.for("query-profiler.patched");
const TX = Symbol.for("query-profiler.tx");

/**
 * Records raw SQL sent through a `pg` pool; returns it untouched outside development. Statements
 * Prisma sends through `profileAdapter` are not counted twice.
 */
export function profilePool<T extends Pool>(pool: T): T {
  if (!enabled()) return pool;
  const marked = pool as T & { [PATCHED]?: true };
  if (marked[PATCHED]) return pool;
  marked[PATCHED] = true;
  pool.on("connect", (client) => patchClient(client as Client));
  const query = pool.query.bind(pool) as QueryFn;
  // By the time a pooled client runs raw SQL, its caller is no longer on the stack.
  pool.query = function (...args: unknown[]) {
    const scope = currentScope();
    if (!scope || scope.opId || scope.recording) return query(...args);
    return runInScope({ origin: captureOrigin() }, () => query(...args));
  } as Pool["query"];
  return pool;
}

function patchClient(client: Client) {
  if (client[PATCHED]) return;
  client[PATCHED] = true;
  const query = client.query.bind(client) as QueryFn;
  client.query = function (...args: unknown[]) {
    const statement = readStatement(args);
    const finish =
      statement &&
      beginStatement(statement.sql, statement.params, trackTransaction(client, statement.sql));
    return finish ? watch(query, args, finish) : query(...args);
  } as PoolClient["query"];
}

function watch(query: QueryFn, args: unknown[], settle: (error?: unknown) => void) {
  const last = args.length - 1;
  const callback = args[last];
  if (typeof callback === "function") {
    args[last] = (error: unknown, ...rest: unknown[]) => {
      settle(error ?? undefined);
      return callback(error, ...rest);
    };
    return query(...args);
  }
  const result = query(...args);
  if (result instanceof Promise)
    result.then(
      () => settle(),
      (error: unknown) => settle(error),
    );
  return result;
}

function readStatement(args: unknown[]): { sql: string; params: unknown[] } | undefined {
  const [config, values] = args;
  const params = Array.isArray(values) ? values : [];
  if (typeof config === "string") return { sql: config, params };
  if (config && typeof config === "object" && "text" in config && typeof config.text === "string") {
    const own = (config as { values?: unknown }).values;
    return { sql: config.text, params: Array.isArray(own) ? own : params };
  }
  return undefined;
}

function trackTransaction(client: Client, sql: string): string | undefined {
  const scope = currentScope();
  if (!scope || scope.recording) return undefined;
  const head = sql.trimStart().slice(0, 17).toUpperCase();
  if (head.startsWith("BEGIN") || head.startsWith("START TRANSACTION"))
    client[TX] = `tx_${scope.profile.nextId++}`;
  const txId = client[TX];
  if (head.startsWith("COMMIT") || head.startsWith("ROLLBACK")) delete client[TX];
  return txId;
}
