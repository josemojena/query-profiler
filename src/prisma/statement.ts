import {
  beginQuery,
  captureOrigin,
  currentScope,
  finishQuery,
  runInScope,
  type DatabaseReference,
  type RowCount,
} from "../core/index.js";
import { linkOperations, readStamp } from "./stamp.js";

export interface Statement {
  sql: string;
  params: unknown[];
  txId?: string;
  database?: DatabaseReference;
}

/**
 * Records one statement around `run`, and the rows `count` reads in its result, unless a layer
 * above is already recording it.
 */
export async function recordStatement<T>(
  statement: Statement,
  run: () => Promise<T>,
  count?: (result: T) => RowCount,
): Promise<T> {
  const scope = currentScope();
  if (!scope || scope.recording) return run();
  const finish = beginStatement(statement);
  try {
    const result = await runInScope({ recording: true }, run);
    finish?.(undefined, count?.(result));
    return result;
  } catch (error) {
    finish?.(withDatabaseCode(error));
    throw error;
  }
}

/** Prisma's adapter errors keep the database's own code and message on `cause`. */
export function withDatabaseCode(error: unknown): unknown {
  const cause = (error as { cause?: { originalCode?: string; originalMessage?: string } }).cause;
  if (!cause?.originalCode) return error;
  return Object.assign(new Error(cause.originalMessage ?? String(error)), {
    code: cause.originalCode,
  });
}

/** Starts recording a statement in the current request; returns how to finish it. */
export function beginStatement({
  sql: rawSql,
  params,
  txId,
  database,
}: Statement): ((error?: unknown, count?: RowCount) => void) | undefined {
  const scope = currentScope();
  if (!scope || scope.recording) return undefined;
  const { sql, stamp } = readStamp(rawSql);
  const record = beginQuery(scope.profile, {
    sql,
    params,
    opIds: linkOperations(scope.profile, sql, stamp, scope.opId),
    txId,
    database,
    origin: stamp || scope.opId ? undefined : (scope.origin ?? captureOrigin()),
  });
  return record && ((error, count) => finishQuery(scope.profile, record, error, count));
}

/** A transaction id for the current request, or none outside one. */
export function newTransactionId(): string | undefined {
  const scope = currentScope();
  return scope && `tx_${scope.profile.nextId++}`;
}
