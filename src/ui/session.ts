import type { Finding } from "../analysis/analyze.js";
import type { IndexPick, RuleSum, SessionAnalysis, Shape, TableUse } from "../analysis/session.js";
import { ENGINES } from "./analysis.js";
import { count } from "./count.js";
import { escape, ms } from "./format.js";
import { askProfiler } from "./http.js";

// The session's analysis, on top of Stats: what to fix first across every stored request. Only
// when asked for, since it asks the database about each statement. Flat, like a query's tools.

export type SessionState = { loading: true } | { session: SessionAnalysis } | { error: string };

export interface SessionView {
  state?: SessionState;
  /** Sections opened: an index's SQL or its queries, the folded findings. */
  open: ReadonlySet<string>;
}

export const emptySession = (): SessionView => ({ open: new Set() });

const SHOWN_WARNINGS = 6;

/** The section on top of Stats: how to ask for the analysis, or what it found. */
export function sessionSection(view: SessionView, base: string, requests: number): string {
  const { state } = view;
  const loading = state !== undefined && "loading" in state;
  const label = loading ? "Analyzing…" : state ? "Analyze again ›" : "Analyze the session ›";
  const button = requests
    ? `<button class="analyze" data-action="session-analyze"${loading ? " disabled" : ""}>${label}</button>`
    : "";
  const head = `<div class="session-head"><h2>Analysis of the session</h2>${button}</div>`;
  const lead = (text: string) =>
    `<section class="session">${head}<div class="lead">${text}</div></section>`;
  if (!requests) return lead("Nothing to analyze yet. Open a page of your app.");
  if (!state)
    return lead(
      `Asks your database for the plan of every distinct statement in the last ${count(requests, "request")} (the same SQL with other values counts once), and adds up which indexes and fixes save the most time. Nothing is run.`,
    );
  if ("loading" in state) return lead("Asking the database about each statement…");
  if ("error" in state) return lead(`Couldn't analyze the session: ${escape(state.error)}`);
  const { session } = state;
  if (!session.shapes)
    return lead(
      `No statement in the last ${count(session.requests, "request")} is one the database can be asked about.`,
    );
  return `<section class="session">${head}<div class="lead">${summary(view, session)}</div>${failures(view, session)}
    ${indexesTable(view, base, session)}
    ${rulesTable(view, base, session.rules)}
    ${tablesTable(session.tables)}
    ${notesList(session)}</section>`;
}

function summary(view: SessionView, session: SessionAnalysis): string {
  const statements = count(session.shapes, "distinct statement");
  const which =
    session.analyzed === session.shapes ? statements : `${session.analyzed} of ${statements}`;
  const databases = session.databases.length
    ? session.databases
        .map((each) => `<b>${ENGINES[each.engine]} ${escape(each.version)}</b>`)
        .join(", ")
    : "the database";
  const skipped = session.skipped
    ? ` ${count(session.skipped, "statement")} could not be asked: ${session.skipped === 1 ? "its" : "their"} connection is gone, or is not one the profiler can ask.`
    : "";
  const failed = session.failed.length
    ? ` The database could not plan ${count(session.failed.length, "statement")}. ${toggle(view, "failed", "Show why", "Hide")}`
    : "";
  return `${which} in ${count(session.requests, "request")}, each planned by ${databases} once, through its slowest run. Nothing was run.${skipped}${failed}`;
}

function failures(view: SessionView, session: SessionAnalysis): string {
  if (!view.open.has("failed")) return "";
  return session.failed
    .map(
      (each) =>
        `<div class="shape"><div class="sql mono clip">${escape(each.sql)}</div><span class="sub">${escape(each.message)}</span></div>`,
    )
    .join("");
}

function indexesTable(view: SessionView, base: string, session: SessionAnalysis): string {
  if (!session.indexes.length)
    return `<h3>Indexes to add</h3><div class="lead">None: no index would help the statements it planned.</div>`;
  const longest = Math.max(...session.indexes.map((pick) => pick.totalMs), 0.01);
  const rows = session.indexes
    .map(
      (pick) => `<tr>
        <td>${indexCell(view, base, pick)}</td>
        <td class="n">${count(pick.shapes.length, "query", "queries")}</td>
        <td class="n">${pick.runs}</td>
        <td class="dur">${ms(pick.totalMs)}${meter(pick.totalMs, longest)}</td>
        <td class="routes mono">${pick.routes.map(escape).join(" · ")}</td>
      </tr>`,
    )
    .join("");
  return `<h3>Indexes to add</h3><table><thead><tr><th>Index</th><th>Fixes</th><th>Runs</th><th>Time</th><th>Where</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function indexCell(view: SessionView, base: string, pick: IndexPick): string {
  const shown = pick.prisma ?? pick.sql ?? pick.name;
  const sqlKey = `sql:${pick.name}`;
  const queriesKey = `queries:${pick.name}`;
  const [only] = pick.shapes;
  const acts = [
    copyButton(shown),
    pick.prisma && pick.sql ? toggle(view, sqlKey, "Show SQL", "Hide SQL") : "",
    pick.shapes.length === 1 && only
      ? openLink(base, only.example, "Open the query ›")
      : toggle(view, queriesKey, `Show the ${pick.shapes.length} queries`, "Hide the queries"),
  ].join("");
  const covers = pick.covers.length
    ? `<div class="sub">Also serves the queries ${pick.covers.map((name) => `<span class="mono">${escape(name)}</span>`).join(", ")} was suggested for.</div>`
    : "";
  const sql =
    pick.prisma && pick.sql && view.open.has(sqlKey)
      ? `<div class="line"><span class="mono">${escape(pick.sql)}</span>${copyButton(pick.sql)}</div>`
      : "";
  const shapes = view.open.has(queriesKey)
    ? pick.shapes
        .map(
          (shape) =>
            `<div class="shape"><div class="sql mono clip">${escape(shape.sql)}</div><span class="sub">${count(shape.runs, "run")} · ${ms(shape.totalMs)}</span>${openLink(base, shape.example, "Open")}</div>`,
        )
        .join("")
    : "";
  return `<span class="mono">${escape(shown)}</span><span class="on-table">on ${escape(pick.table)}</span><div class="acts">${acts}</div>${covers}${sql}${shapes}`;
}

function rulesTable(view: SessionView, base: string, rules: RuleSum[]): string {
  if (!rules.length)
    return `<h3>What the rules find</h3><div class="lead">Nothing to fix in how they read.</div>`;
  let warnings = 0;
  const shown = rules.filter(
    (rule) =>
      rule.severity === "problem" || (rule.severity === "warning" && ++warnings <= SHOWN_WARNINGS),
  );
  const folded = rules.filter((rule) => !shown.includes(rule));
  const open = view.open.has("rules");
  const longest = Math.max(...rules.map((rule) => rule.totalMs), 0.01);
  const rows = (open ? [...shown, ...folded] : shown)
    .map(
      (rule) => `<tr>
        <td class="n"><span class="badge ${rule.severity}">${rule.severity}</span></td>
        <td>${escape(rule.message)}</td>
        <td class="n">${rule.shapes}</td>
        <td class="n">${rule.runs}</td>
        <td class="dur">${ms(rule.totalMs)}${meter(rule.totalMs, longest)}</td>
        <td class="n">${openLink(base, rule.example, "Open")}</td>
      </tr>`,
    )
    .join("");
  const more = folded.filter((rule) => rule.severity === "warning").length;
  const info = folded.length - more;
  const fold = folded.length
    ? `<div class="fold">${toggle(view, "rules", "▸", "▾")} <b>${[more ? count(more, "more warning") : "", info ? count(info, "info finding") : ""].filter(Boolean).join(" and ")}</b> ${toggle(view, "rules", "Show", "Hide")}</div>`
    : "";
  return `<h3>What the rules find</h3><table><thead><tr><th></th><th>Finding</th><th>Queries</th><th>Runs</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table>${fold}`;
}

function tablesTable(tables: TableUse[]): string {
  if (!tables.length) return "";
  const longest = Math.max(...tables.map((table) => table.totalMs), 0.01);
  const rows = tables
    .map(
      (table) => `<tr>
        <td><b>${escape(table.table)}</b></td>
        <td class="n">${table.shapes}</td>
        <td class="n">${table.runs}</td>
        <td class="dur">${ms(table.totalMs)}${meter(table.totalMs, longest)}</td>
        <td class="n">${table.fullReads ? `${table.fullReads} of ${count(table.shapes, "query", "queries")}` : "–"}</td>
      </tr>`,
    )
    .join("");
  return `<h3>Tables</h3><table><thead><tr><th>Table</th><th>Queries</th><th>Runs</th><th>Time</th><th>Read in full</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function notesList(session: SessionAnalysis): string {
  if (!session.notes.length) return "";
  const [only] = session.databases;
  const manual =
    session.databases.length === 1 && only ? `${ENGINES[only.engine]} manual` : "Manual";
  return `<div class="h">About the tables, whatever the query</div>${session.notes.map((note) => noteHtml(note, manual)).join("")}`;
}

function noteHtml(note: Finding, manual: string): string {
  const shown = note.fix?.prisma ?? note.fix?.sql;
  const fix = note.fix
    ? `<span class="fix">${escape(note.fix.text)}</span>${shown ? `<div class="line"><span class="mono">${escape(shown)}</span>${copyButton(shown)}</div>` : ""}`
    : "";
  const docs = note.docs
    ? `<a class="docs" href="${escape(note.docs)}" target="_blank" rel="noopener">${manual}</a>`
    : "<span></span>";
  return `<div class="find"><span><span class="badge ${note.severity}">${note.severity}</span></span><div class="what"><span class="msg">${escape(note.message)}</span>${fix}</div>${docs}</div>`;
}

const meter = (value: number, longest: number) =>
  `<div class="meter" style="width:${Math.max(2, (value / longest) * 100)}%"></div>`;

const toggle = (view: SessionView, key: string, closed: string, open: string) =>
  `<button class="link" data-action="session-section" data-key="${escape(key)}">${view.open.has(key) ? open : closed}</button>`;

// The address names the query too: its request opens on it, on Explain plan.
const openLink = (base: string, { token, queryId }: Shape["example"], label: string) =>
  `<a class="link" href="${escape(`${base}/${token}#${queryId}`)}" data-action="go">${label}</a>`;

const copyButton = (text: string) =>
  `<button class="link" data-action="copy-text" data-copy="${escape(text)}">Copy</button>`;

/** What an action in the session's section does; false when the action is none of them. */
export function sessionAction(
  target: HTMLElement,
  view: SessionView,
  base: string,
  rerender: () => void,
): boolean {
  switch (target.dataset.action) {
    case "session-analyze":
      if (view.state && "loading" in view.state) return true;
      view.state = { loading: true };
      rerender();
      void askProfiler<SessionAnalysis>(`${base}/api/stats/analysis`).then((result) => {
        view.state = "error" in result ? result : { session: result.body };
        view.open = new Set();
        rerender();
      });
      return true;
    case "session-section": {
      const key = target.dataset.key!;
      const open = new Set(view.open);
      if (!open.delete(key)) open.add(key);
      view.open = open;
      rerender();
      return true;
    }
    default:
      return false;
  }
}
