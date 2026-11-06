import { isAbsolute, relative, sep } from "node:path";
import { fromRequest, type Profile, type QueryRecord, type Warning } from "./profile.js";

const SHOWN_WARNINGS = 5;
const WARNING_NAMES = { "n+1": "N+1", duplicate: "duplicate", slow: "slow", truncated: "" };

/** A file as typed from the working directory (`prisma/seed.ts`), or whole when it is outside it. */
export function shownPath(file: string): string {
  if (!isAbsolute(file)) return file;
  const path = relative(process.cwd(), file);
  return path === ".." || path.startsWith(`..${sep}`) ? file : path;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** One line per profile, for a dev server console. */
export function formatProfile(profile: Profile): string {
  const { request, response, summary } = profile;
  const what = fromRequest(profile)
    ? `${request.method} ${request.url} ${response?.status ?? "-"}`
    : `${profile.kind}${request.url ? ` ${request.url}` : ""}`;
  const warnings = profile.warnings.length ? ` · ${count(profile.warnings.length, "warning")}` : "";
  return `[query-profiler] ${what} · ${count(summary.queryCount, "query", "queries")} · ${summary.dbTimeMs} ms in db · ${count(summary.operationCount, "operation")}${warnings} · ${profile.durationMs} ms · ${profile.token}`;
}

/** A line per warning, with what ran and the line of code behind it, for a terminal. */
export function formatWarnings(profile: Profile): string[] {
  // Each statement of one call counts on its own: one line for the call says it.
  const shown = [
    ...new Map(
      profile.warnings
        .filter((warning) => warning.kind !== "truncated")
        .map((warning) => describe(profile, warning))
        .map((row) => [row.join("\u0000"), row]),
    ).values(),
  ];
  const rows = shown.slice(0, SHOWN_WARNINGS);
  const width = Math.max(0, ...rows.map(([, what]) => what.length));
  const lines = rows.map(([name, what, line]) =>
    `${name.padEnd(9)}  ${what.padEnd(width)}  ${line}`.trimEnd(),
  );
  if (shown.length > SHOWN_WARNINGS)
    lines.push(`and ${count(shown.length - SHOWN_WARNINGS, "more warning")}`);
  const { unrecordedQueries } = profile.summary;
  if (unrecordedQueries)
    lines.push(
      `${count(profile.summary.queryCount + unrecordedQueries, "query", "queries")}: the first ${profile.summary.queryCount.toLocaleString("en-US")} recorded, the rest only counted`,
    );
  return lines;
}

function describe(profile: Profile, warning: Warning): [string, string, string] {
  const query = profile.queries.find((each) => each.id === warning.queryIds[0]);
  const operation = query && profile.operations.find((op) => op.id === query.opId);
  const name = operation
    ? `${operation.model ? `${operation.model}.` : ""}${operation.action}`
    : shortSql(query);
  const amount =
    warning.kind === "slow"
      ? `${Math.round(query?.durationMs ?? 0)} ms`
      : count(warning.queryIds.length, "time");
  const frame = (operation?.origin ?? query?.origin)?.[0];
  const line = frame ? `${shownPath(frame.file)}:${frame.line}` : "";
  return [WARNING_NAMES[warning.kind], `${name}, ${amount}`, line];
}

const shortSql = (query: QueryRecord | undefined) => {
  const sql = (query?.sql ?? "").replace(/\s+/g, " ").trim();
  return sql.length > 40 ? `${sql.slice(0, 39)}…` : sql;
};
