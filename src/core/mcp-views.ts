import { relative } from "node:path";
import type { Analysis } from "../analysis/analyze.js";
import type { N1Fix } from "../analysis/n1.js";
import { fromRequest, type Profile, type StackFrame } from "./profile.js";

const MAX_QUERIES = 300;
const MAX_SQL = 400;

// What an agent reads: the same records, without what only the page needs, paths from the root.

const lineOf = (root: string, frames: StackFrame[] | undefined) => {
  const frame = frames?.[0];
  return frame ? `${relative(root, frame.file)}:${frame.line}` : undefined;
};

const named = (profile: Profile) =>
  fromRequest(profile)
    ? `${profile.request.method} ${profile.request.url}`
    : `${profile.kind} ${profile.request.url}`.trim();

/** One line of a list: what ran, when, and what it cost in the database. */
export function listed(profile: Profile) {
  return {
    token: profile.token,
    kind: profile.kind,
    request: named(profile),
    status: profile.response?.status,
    parent: profile.parentToken,
    startedAt: new Date(profile.startedAt).toISOString(),
    durationMs: profile.durationMs,
    queries: profile.summary.queryCount,
    dbTimeMs: profile.summary.dbTimeMs,
    warnings: [...new Set(profile.warnings.map((warning) => warning.kind))],
  };
}

/** A whole profile: its warnings, its operations, and each query with its line of code. */
export function detailed(profile: Profile, root: string) {
  const operations = new Map(profile.operations.map((op) => [op.id, op]));
  const queries = profile.queries.slice(0, MAX_QUERIES);
  return {
    ...listed(profile),
    summary: profile.summary,
    warnings: profile.warnings.map((warning) => {
      const query = profile.queries.find((each) => each.id === warning.queryIds[0]);
      const op = query?.opId ? operations.get(query.opId) : undefined;
      return {
        kind: warning.kind,
        queries: warning.queryIds,
        operation: op && callOf(op),
        line: lineOf(root, op?.origin ?? query?.origin),
        sql: query?.sql.slice(0, MAX_SQL),
      };
    }),
    operations: profile.operations.map((op) => ({
      id: op.id,
      call: callOf(op),
      args: op.args,
      line: lineOf(root, op.origin),
      durationMs: op.durationMs,
      error: op.error,
      queries: op.queryIds,
    })),
    queries: queries.map((query) => ({
      id: query.id,
      operation: query.opId,
      transaction: query.txId,
      sql: query.sql,
      params: query.params,
      rows: query.rows,
      changedRows: query.changedRows,
      durationMs: query.durationMs,
      line: lineOf(root, query.origin ?? operations.get(query.opId ?? "")?.origin),
      error: query.error,
    })),
    ...(profile.queries.length > queries.length
      ? { omittedQueries: profile.queries.length - queries.length }
      : {}),
  };
}

const callOf = (op: { model?: string; action: string }) =>
  op.model ? `${op.model}.${op.action}` : op.action;

/** An N+1's fix, its code as one text to paste, the lines it adds named apart. */
export function fixed(queryId: string, fix: N1Fix, root: string) {
  return {
    query: queryId,
    operation: fix.operation,
    times: fix.times,
    line: lineOf(root, fix.origin && [fix.origin]),
    changing: fix.varying && {
      argument: fix.varying.path,
      values: fix.varying.values,
      count: fix.varying.count,
    },
    source: fix.source && {
      operation: fix.source.operation,
      line: lineOf(root, fix.source.origin && [fix.source.origin]),
      rows: fix.source.rows,
    },
    relation: fix.relation,
    options: fix.options.map((option) => ({
      title: option.title,
      code: option.lines.map((line) => line.text).join("\n"),
      addedLines: option.lines.filter((line) => line.added).map((line) => line.text.trim()),
      queries: option.queries,
      insteadOf: option.instead,
      note: option.note,
    })),
    note: fix.note,
  };
}

/** A query's analysis, without the database's raw plan text: its steps, findings and tables. */
export function explained(analysis: Analysis) {
  const { plan, noPlan, findings, tables, engine, version } = analysis;
  return {
    engine,
    version,
    ...(plan
      ? {
          measured: plan.measured,
          estimatedWithoutValues: plan.generic,
          steps: plan.steps,
        }
      : { noPlan: noPlan?.message }),
    findings,
    tables: tables.map((table) => ({
      name: table.name,
      rows: table.rows,
      columns: table.columns.map((column) => column.name),
      indexes: table.indexes.map((index) => ({
        name: index.name,
        columns: index.columns,
        unique: index.unique,
        primary: index.primary,
      })),
    })),
  };
}
