import type {
  OperationRecord,
  Profile,
  ProfileKind,
  QueryRecord,
  StackFrame,
  Warning,
} from "../core/index.js";
import { clue, explainLink, fixLink, toolsRow, type AnalysisView } from "./analysis.js";
import { count } from "./count.js";
import {
  editorLink,
  escape,
  fromRequest,
  ms,
  shortPath,
  statusTone,
  type Editor,
} from "./format.js";
import { formatSql, highlightSql } from "./sql.js";

// What a single request shows, in the bar and in the profiler page.

export type DetailTab = "queries" | "operations" | "timeline" | "warnings" | "request";

export interface Detail {
  base: string;
  root: string;
  editor: Editor;
  /** Query rows opened to show their whole SQL. */
  expanded: ReadonlySet<string>;
  /** What the analysis found, and the plans asked for. */
  analysis: AnalysisView;
}

export function detail(context: Detail, profile: Profile, tab: DetailTab): string {
  switch (tab) {
    case "queries":
      return queriesTab(context, profile);
    case "operations":
      return operationsTab(context, profile);
    case "timeline":
      return timelineTab(profile);
    case "warnings":
      return warningsTab(context, profile);
    case "request":
      return requestTab(context, profile);
  }
}

/** A tab's name for this profile: the work no request started shows its run, not a request. */
export const tabLabel = (profile: Pick<Profile, "kind">, tab: string, label: string) =>
  tab === "request" && !fromRequest(profile) ? "Run" : label;

export const label = (op: OperationRecord) => (op.model ? `${op.model}.${op.action}` : op.action);
const operationOf = (profile: Profile, query: QueryRecord) =>
  query.opId ? profile.operations.find((op) => op.id === query.opId) : undefined;
const originOf = (profile: Profile, query: QueryRecord) =>
  query.origin ?? operationOf(profile, query)?.origin;
const warningsFor = (profile: Profile, query: QueryRecord) =>
  profile.warnings.filter((warning) => warning.queryIds.includes(query.id));
const compact = (value: unknown, max: number) => {
  const text = JSON.stringify(value) ?? "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

function originCell(context: Detail, frames: StackFrame[] | undefined): string {
  const frame = frames?.[0];
  if (!frame) return `<td class="origin"><span class="sub">–</span></td>`;
  const link = editorLink(frame, context.editor);
  return `<td class="origin"><span class="mono">${escape(shortPath(frame.file, context.root))}:${frame.line}</span>${
    link ? `<div class="sub"><a href="${escape(link)}">open in editor</a></div>` : ""
  }</td>`;
}

interface QueryRow {
  queries: QueryRecord[];
  repeated: boolean;
}

/** N+1 groups collapse into one row; everything else is one row per query. */
export function queryRows(profile: Profile): QueryRow[] {
  const groups = profile.warnings.filter((warning) => warning.kind === "n+1");
  const seen = new Set<Warning>();
  const rows: QueryRow[] = [];
  for (const query of profile.queries) {
    const group = groups.find((warning) => warning.queryIds.includes(query.id));
    if (!group) rows.push({ queries: [query], repeated: false });
    else if (!seen.has(group)) {
      seen.add(group);
      rows.push({
        queries: profile.queries.filter((q) => group.queryIds.includes(q.id)),
        repeated: true,
      });
    }
  }
  return rows;
}

function queriesTab(context: Detail, profile: Profile): string {
  if (!profile.queries.length) return `<div class="empty">No queries in this request.</div>`;
  const longest = Math.max(...profile.queries.map((query) => query.durationMs ?? 0), 1);
  const rows = queryRows(profile)
    .map((row, index) => {
      const [first] = row.queries as [QueryRecord];
      const expanded = context.expanded.has(first.id);
      const op = operationOf(profile, first);
      const kinds = new Set(
        row.queries.flatMap((query) => warningsFor(profile, query).map((w) => w.kind)),
      );
      const badges = [
        row.repeated ? `<span class="badge n1">N+1 ×${row.queries.length}</span>` : "",
        kinds.has("duplicate") ? `<span class="badge duplicate">duplicate</span>` : "",
        kinds.has("slow") ? `<span class="badge slow">slow</span>` : "",
        row.queries.some((query) => query.error) ? `<span class="badge error">error</span>` : "",
      ].join("");
      const what = op ? label(op) : first.txId ? `transaction ${first.txId}` : "raw SQL";
      const detail = row.repeated
        ? `${row.queries.length} times from the same place`
        : first.params.length
          ? `params ${escape(compact(first.params, 120))}`
          : "";
      const average =
        row.queries.reduce((sum, query) => sum + (query.durationMs ?? 0), 0) / row.queries.length;
      const tone = kinds.has("slow") ? "slow" : row.repeated ? "n1" : "";
      const children =
        expanded && row.repeated
          ? row.queries
              .map(
                (query) =>
                  `<tr class="child"><td></td><td><div class="sub">params ${escape(compact(query.params, 120))}</div></td><td class="rows">${rowsOf(query)}</td><td class="dur">${ms(query.durationMs)}</td><td></td></tr>`,
              )
              .join("")
          : "";
      return `<tr class="${row.repeated || kinds.has("duplicate") ? "warn" : ""}${expanded ? " open" : ""}">
        <td class="num">${index + 1}</td>
        <td>
          <div class="sql mono ${expanded ? "formatted" : "clip"}" data-action="expand" data-id="${escape(first.id)}">${expanded ? highlightSql(formatSql(first.sql)) : escape(first.sql)}${badges}</div>
          ${expanded ? "" : clue(context.analysis, first)}
          <div class="meta"><div class="sub">${escape(what)}${detail ? ` · ${detail}` : ""}${first.error ? ` · <span class="badge error">${escape(first.error.code ?? "")}</span> ${escape(first.error.message)}` : ""}</div>${expanded ? "" : `<span class="links">${row.repeated ? fixLink(first) : ""}${explainLink(first)}</span>`}</div>
        </td>
        <td class="rows">${rowsCell(row.queries)}</td>
        <td class="dur">${row.repeated ? `${row.queries.length} × ${ms(average)}` : `<b>${ms(first.durationMs)}</b>`}<div class="meter ${tone}" style="width:${Math.max(4, ((row.repeated ? average : (first.durationMs ?? 0)) / longest) * 100)}%"></div></td>
        ${originCell(context, originOf(profile, first))}
      </tr>${expanded ? toolsRow(context.analysis, first, row.queries.length, context.root) : ""}${children}`;
    })
    .join("");
  return `<table><thead><tr><th>#</th><th>SQL · operation</th><th>Rows</th><th>Duration</th><th>Origin</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The rows a query returned, or the rows a write changed. */
const rowsOf = (query: QueryRecord) =>
  query.rows !== undefined
    ? query.rows.toLocaleString("en-US")
    : query.changedRows !== undefined
      ? `${query.changedRows.toLocaleString("en-US")} changed`
      : "–";

/** One query's rows; for an N+1, the rows of each run, or of all of them when they differ. */
function rowsCell(queries: QueryRecord[]): string {
  if (queries.length === 1) return rowsOf(queries[0]!);
  const each = new Set(queries.map(rowsOf));
  if (each.size === 1) return `${queries.length} × ${[...each][0]}`;
  const total = queries.reduce((sum, query) => sum + (query.rows ?? 0), 0);
  return `${total.toLocaleString("en-US")} in all`;
}

function operationsTab(context: Detail, profile: Profile): string {
  if (!profile.operations.length)
    return `<div class="empty">No Prisma operations in this request.</div>`;
  const longest = Math.max(...profile.operations.map((op) => op.durationMs ?? 0), 1);
  const rows = profile.operations
    .map(
      (op, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td><b>${escape(label(op))}</b>${op.error ? `<span class="badge error">error</span>` : ""}
          <div class="sub mono">${escape(compact(op.args ?? {}, 200))}</div>
          ${op.error ? `<div class="sub">${escape(op.error.message)}</div>` : ""}</td>
        <td class="dur"><b>${ms(op.durationMs)}</b><div class="meter" style="width:${Math.max(4, ((op.durationMs ?? 0) / longest) * 100)}%"></div></td>
        <td>${count(op.queryIds.length, "query", "queries")}</td>
        <td class="rows">${operationRows(profile, op)}</td>
        ${originCell(context, op.origin)}
      </tr>`,
    )
    .join("");
  return `<table><thead><tr><th>#</th><th>Operation · args</th><th>Duration</th><th>SQL</th><th>Rows</th><th>Origin</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** An operation's rows: those of its first statement, the one on its own model. */
function operationRows(profile: Profile, op: OperationRecord): string {
  const first = profile.queries.find((query) => query.id === op.queryIds[0]);
  return first ? rowsOf(first) : "–";
}

function timelineTab(profile: Profile): string {
  const ends = [
    ...profile.operations.map((op) => op.startMs + (op.durationMs ?? 0)),
    ...profile.queries.map((query) => query.startMs + (query.durationMs ?? 0)),
  ];
  const scale = Math.max(profile.durationMs ?? 0, ...ends, 1);
  const bar = (start: number, duration: number | undefined, tone: string) =>
    `<i class="${tone}" style="left:${(start / scale) * 100}%;width:${((duration ?? 0) / scale) * 100}%"></i>`;
  const tone = (queryIds: string[]) => {
    const kinds = new Set(
      profile.warnings
        .filter((w) => w.queryIds.some((id) => queryIds.includes(id)))
        .map((w) => w.kind),
    );
    return kinds.has("slow") ? "slow" : kinds.has("n+1") ? "n1" : "";
  };
  const rows: string[] = [];
  const byOperation = new Map<string, OperationRecord[]>();
  for (const op of profile.operations) {
    const key = `${label(op)}@${op.origin?.[0]?.file}:${op.origin?.[0]?.line}`;
    byOperation.set(key, [...(byOperation.get(key) ?? []), op]);
  }
  for (const ops of byOperation.values()) {
    const name = `${label(ops[0]!)}${ops.length > 1 ? ` ×${ops.length}` : ""}`;
    rows.push(
      `<div class="label" title="${escape(name)}">${escape(name)}</div><div class="track">${ops.map((op) => bar(op.startMs, op.durationMs, tone(op.queryIds))).join("")}</div>`,
    );
  }
  const loose = profile.queries.filter((query) => !query.opId);
  const byShape = new Map<string, QueryRecord[]>();
  for (const query of loose)
    byShape.set(query.txId ?? query.fingerprint, [
      ...(byShape.get(query.txId ?? query.fingerprint) ?? []),
      query,
    ]);
  for (const [key, queries] of byShape) {
    const name = queries[0]!.txId === key ? `transaction ${key}` : queries[0]!.sql.slice(0, 48);
    rows.push(
      `<div class="label mono" title="${escape(queries[0]!.sql)}">${escape(name)}</div><div class="track">${queries.map((query) => bar(query.startMs, query.durationMs, `raw ${tone([query.id])}`)).join("")}</div>`,
    );
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1]
    .map((at) => `<span style="left:${at * 100}%">${Math.round(scale * at)} ms</span>`)
    .join("");
  return `<div class="timeline"><div></div><div class="axis">${ticks}</div>${rows.join("")}</div>
    <div class="hint">Operations and the SQL outside them, over the ${ms(profile.durationMs)} of the ${fromRequest(profile) ? "request" : "run"}.</div>`;
}

const WARNING_TEXT: Record<Warning["kind"], (count: number, profile: Profile) => string> = {
  "n+1": (count) =>
    `The same statement ran ${count} times: likely an N+1. Load it once with include or a single query.`,
  duplicate: (count) => `The same SQL with the same parameters ran ${count} times.`,
  slow: () => `This query took 100 ms or more.`,
  truncated: (_count, { summary }) =>
    summary.unrecordedQueries
      ? `${(summary.queryCount + summary.unrecordedQueries).toLocaleString("en-US")} queries: the first ${summary.queryCount.toLocaleString("en-US")} are here, the rest were only counted.`
      : `More than 1,000 queries: the rest were not recorded.`,
};

function warningsTab(context: Detail, profile: Profile): string {
  if (!profile.warnings.length) return `<div class="empty">No warnings. Nice.</div>`;
  const rows = profile.warnings
    .map((warning) => {
      const query = profile.queries.find((q) => q.id === warning.queryIds[0]);
      return `<tr class="warn">
        <td><span class="badge ${warning.kind === "n+1" ? "n1" : warning.kind === "truncated" ? "slow" : warning.kind}">${warning.kind === "n+1" ? "N+1" : warning.kind}</span></td>
        <td>${escape(WARNING_TEXT[warning.kind](warning.queryIds.length, profile))}${query ? `<div class="sub mono sql clip">${escape(query.sql)}</div>` : ""}${warning.kind === "n+1" && query ? `<div class="links">${fixLink(query)}</div>` : ""}</td>
        ${query ? originCell(context, originOf(profile, query)) : "<td></td>"}
      </tr>`;
    })
    .join("");
  return `<table><thead><tr><th>Kind</th><th>What</th><th>Origin</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const RUNS: Partial<Record<ProfileKind, { note: string; name: string }>> = {
  script: { note: "a process that never listened: its whole run", name: "File" },
  startup: { note: "what the server did before it listened", name: "File" },
  task: { note: "one run of profileTask()", name: "Task" },
  background: {
    note: "queries outside any request, until 200 ms passed with none",
    name: "Started at",
  },
};

function requestTab(context: Detail, profile: Profile): string {
  const json = `${context.base}/api/profiles/${profile.token}`;
  const run = RUNS[profile.kind];
  if (run)
    return terms([
      ["Kind", `${profile.kind} <span class="sub">(${run.note})</span>`],
      [run.name, `<span class="mono">${escape(profile.request.url || "–")}</span>`],
      ["Duration", ms(profile.durationMs)],
      [
        "Time in database",
        `${ms(profile.summary.dbTimeMs)} <span class="sub">(busy time; queries in parallel count once)</span>`,
      ],
      ["Started", new Date(profile.startedAt).toLocaleString()],
      ["Token", `<span class="mono">${escape(profile.token)}</span>`],
      ["JSON", `<a href="${escape(json)}" target="_blank" rel="noopener">${escape(json)}</a>`],
    ]);
  return terms([
    ["Method", escape(profile.request.method)],
    ["URL", `<span class="mono">${escape(profile.request.url)}</span>`],
    [
      "Status",
      `<span class="status tone-${statusTone(profile.response?.status)}">${profile.response?.status ?? "…"}</span>`,
    ],
    ["Kind", profile.kind],
    ["Duration", ms(profile.durationMs)],
    [
      "Time in database",
      `${ms(profile.summary.dbTimeMs)} <span class="sub">(busy time; queries in parallel count once)</span>`,
    ],
    ["Started", new Date(profile.startedAt).toLocaleString()],
    ["Framework", escape(profile.framework.name)],
    [
      "Token",
      `<span class="mono">${escape(profile.token)}</span> <span class="sub">(X-Debug-Token)</span>`,
    ],
    ["JSON", `<a href="${escape(json)}" target="_blank" rel="noopener">${escape(json)}</a>`],
  ]);
}

const terms = (rows: [string, string][]) =>
  `<dl>${rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join("")}</dl>`;
