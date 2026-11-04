import { randomBytes } from "node:crypto";
import { analyze, busyMs } from "./analyze.js";
import { fingerprint } from "./fingerprint.js";
import type {
  OperationRecord,
  Profile,
  ProfileSummary,
  QueryRecord,
  RecordError,
  RequestMeta,
  ResponseMeta,
  StackFrame,
} from "./profile.js";
import { sanitize } from "./sanitize.js";
import { storeProfile } from "./storage.js";

export const MAX_QUERIES = 1000;

export interface ActiveProfile {
  readonly profile: Profile;
  readonly startedAt: number;
  closed: boolean;
  truncated: boolean;
  nextId: number;
}

export function startProfile(request: RequestMeta, framework: Profile["framework"]): ActiveProfile {
  const { kind, parentToken, ...meta } = request;
  return {
    profile: {
      schemaVersion: 1,
      token: randomBytes(3).toString("hex"),
      ...(parentToken ? { parentToken } : {}),
      kind,
      request: meta,
      startedAt: Date.now(),
      framework,
      operations: [],
      queries: [],
      warnings: [],
      summary: { queryCount: 0, dbTimeMs: 0, operationCount: 0, errorCount: 0 },
    },
    startedAt: performance.now(),
    closed: false,
    truncated: false,
    nextId: 1,
  };
}

export function beginOperation(
  active: ActiveProfile,
  operation: { model?: string; action: string; args?: unknown; origin?: StackFrame[] },
): OperationRecord {
  const record: OperationRecord = {
    id: `op_${active.nextId++}`,
    model: operation.model,
    action: operation.action,
    args: sanitize(operation.args),
    startMs: elapsed(active),
    origin: operation.origin,
    queryIds: [],
  };
  active.profile.operations.push(record);
  return record;
}

export function finishOperation(active: ActiveProfile, record: OperationRecord, error?: unknown) {
  record.durationMs = round(elapsed(active) - record.startMs);
  if (error !== undefined) record.error = toError(error);
}

export function beginQuery(
  active: ActiveProfile,
  query: {
    sql: string;
    params?: unknown[];
    opIds?: string[];
    txId?: string;
    origin?: StackFrame[];
  },
): QueryRecord | undefined {
  if (active.profile.queries.length >= MAX_QUERIES) {
    active.truncated = true;
    return undefined;
  }
  const record: QueryRecord = {
    id: `q_${active.nextId++}`,
    opId: query.opIds?.[0],
    txId: query.txId,
    sql: query.sql,
    params: sanitize(query.params ?? []) as unknown[],
    fingerprint: fingerprint(query.sql),
    startMs: elapsed(active),
    origin: query.origin,
  };
  active.profile.queries.push(record);
  for (const op of active.profile.operations)
    if (query.opIds?.includes(op.id)) op.queryIds.push(record.id);
  return record;
}

export function finishQuery(active: ActiveProfile, record: QueryRecord, error?: unknown) {
  record.durationMs = round(elapsed(active) - record.startMs);
  if (error !== undefined) record.error = toError(error);
}

export function endProfile(active: ActiveProfile, response?: ResponseMeta): Profile {
  const { profile } = active;
  if (active.closed) return profile;
  active.closed = true;
  profile.response = response;
  profile.durationMs = elapsed(active);
  profile.warnings = analyze(profile);
  if (active.truncated) profile.warnings.push({ kind: "truncated", queryIds: [] });
  profile.summary = summarize(profile);
  storeProfile(profile);
  return profile;
}

function summarize(profile: Profile): ProfileSummary {
  const failedQueries = profile.queries.filter((query) => query.error && !query.opId).length;
  const failedOperations = profile.operations.filter((op) => op.error).length;
  return {
    queryCount: profile.queries.length,
    dbTimeMs: busyMs(profile.queries),
    operationCount: profile.operations.length,
    errorCount: failedQueries + failedOperations,
  };
}

const round = (ms: number) => Math.round(ms * 100) / 100;
const elapsed = (active: ActiveProfile) => round(performance.now() - active.startedAt);

function toError(error: unknown): RecordError {
  if (!(error instanceof Error)) return { message: String(error) };
  const code = (error as { code?: unknown }).code;
  return { message: error.message, code: typeof code === "string" ? code : undefined };
}
