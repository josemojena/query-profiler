export type ProfileKind = "document" | "data" | "action" | "api" | "background";

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  fn?: string;
}

export interface RequestMeta {
  method: string;
  url: string;
  kind: ProfileKind;
  route?: string;
  /** The profile of the page that made this call. */
  parentToken?: string;
}

export interface ResponseMeta {
  status: number;
}

export interface RecordError {
  message: string;
  code?: string;
}

export interface OperationRecord {
  id: string;
  model?: string;
  action: string;
  args?: unknown;
  /** Milliseconds since the profile started. */
  startMs: number;
  durationMs?: number;
  error?: RecordError;
  origin?: StackFrame[];
  queryIds: string[];
}

export interface QueryRecord {
  id: string;
  opId?: string;
  txId?: string;
  sql: string;
  params: unknown[];
  fingerprint: string;
  /** Milliseconds since the profile started. */
  startMs: number;
  /** From the client sending the query to the database answering, not execution time alone. */
  durationMs?: number;
  error?: RecordError;
  origin?: StackFrame[];
}

export type WarningKind = "n+1" | "slow" | "duplicate" | "truncated";

export interface Warning {
  kind: WarningKind;
  queryIds: string[];
  fingerprint?: string;
}

export interface ProfileSummary {
  queryCount: number;
  /** The time the database was busy: concurrent queries count once. */
  dbTimeMs: number;
  operationCount: number;
  errorCount: number;
}

export interface Profile {
  schemaVersion: 1;
  token: string;
  parentToken?: string;
  kind: ProfileKind;
  request: Omit<RequestMeta, "kind" | "parentToken">;
  response?: ResponseMeta;
  /** Epoch milliseconds. */
  startedAt: number;
  durationMs?: number;
  framework: { name: string; version?: string };
  operations: OperationRecord[];
  queries: QueryRecord[];
  warnings: Warning[];
  summary: ProfileSummary;
}

/** What a list of profiles shows: everything but the records. */
export type ProfileListItem = Omit<Profile, "operations" | "queries" | "warnings"> & {
  warningCount: number;
};
