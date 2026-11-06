/** What a request asked for, or, for work no request started, what ran: a script, a server's startup, a task, or queries between requests. */
export type ProfileKind =
  | "document"
  | "data"
  | "action"
  | "api"
  | "script"
  | "startup"
  | "task"
  | "background";

const WORK_KINDS: ProfileKind[] = ["script", "startup", "task", "background"];

/** Whether a request started the profile, rather than a script, a task or a server's own work. */
export const fromRequest = (profile: { kind: ProfileKind }) => !WORK_KINDS.includes(profile.kind);

export interface StackFrame {
  file: string;
  line: number;
  column?: number;
  fn?: string;
}

export interface RequestMeta {
  /** Empty for the work no request started. */
  method: string;
  /** For the work no request started, its name: the script's file, the task's name, the line that ran it. */
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

/** The SQL a database speaks, as Prisma's driver adapters name it. */
export type Provider = "postgres" | "mysql" | "sqlite";

export interface DatabaseReference {
  /** The connection, in the process that recorded the query. */
  id: string;
  provider: Provider;
}

export interface QueryRecord {
  id: string;
  opId?: string;
  txId?: string;
  /** The connection that ran it, to ask the database about it later. */
  database?: DatabaseReference;
  sql: string;
  params: unknown[];
  fingerprint: string;
  /** Milliseconds since the profile started. */
  startMs: number;
  /** From the client sending the query to the database answering, not execution time alone. */
  durationMs?: number;
  /** The rows it returned. */
  rows?: number;
  /** The rows a write changed, when it returned none. */
  changedRows?: number;
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
  /** Queries past the limit a profile keeps: counted, not recorded. */
  unrecordedQueries?: number;
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
