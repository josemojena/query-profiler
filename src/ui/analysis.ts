import type { Analysis, Finding, Trial } from "../analysis/analyze.js";
import type { NoPlan } from "../analysis/explain.js";
import type { FixOption, N1Fix } from "../analysis/n1.js";
import type { Engine, PlanStep } from "../analysis/plan.js";
import type { QueryRecord, StackFrame } from "../core/index.js";
import { count } from "./count.js";
import { escape, ms, shortPath } from "./format.js";
import { askProfiler } from "./http.js";

// A query's tools, in a row of their own under its open row: Explain plan and Measure it, each
// with its own answer, the findings and their fixes. Flat, like the rest of the profiler.

export type PlanState = { loading: true } | { analysis: Analysis } | { error: string };

export type TrialState = { loading: true } | { trial: Trial } | { error: string };

export type FixesState = { loading: true } | { fixes: Record<string, N1Fix> } | { error: string };

export type QueryTab = "fix" | "explain" | "measure";

export interface AnalysisView {
  /** What each query's SQL shows without asking the database, by query id. */
  findings: Record<string, Finding[]>;
  /** The estimated plans asked for, by query id. */
  estimates: Record<string, PlanState>;
  /** The measured plans asked for, by query id. */
  measures: Record<string, PlanState>;
  /** The tab open in each open query's tools. */
  tabs: Record<string, QueryTab>;
  /** The indexes tried, by query id and index name. */
  trials: Record<string, TrialState>;
  /** Sections opened: a fix's SQL, a table's notes, the database's own plan. */
  open: ReadonlySet<string>;
  /** The code that replaces each N+1 of the profile, asked for once. */
  fixes?: FixesState;
}

export const emptyAnalysis = (): AnalysisView => ({
  findings: {},
  estimates: {},
  measures: {},
  tabs: {},
  trials: {},
  open: new Set(),
});

/** Each engine's name, as its makers write it. */
export const ENGINES: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
};
const SEVERITY = { problem: 0, warning: 1, info: 2 };
// Past comments and an opening parenthesis, the statement's first word.
const LEAD = String.raw`^\s*(?:\/\*[\s\S]*?\*\/\s*)*\(?\s*`;
const EXPLAINABLE = new RegExp(
  `${LEAD}(?:SELECT|WITH|VALUES|TABLE|INSERT|UPDATE|DELETE|REPLACE|MERGE)\\b`,
  "i",
);
const READ = new RegExp(`${LEAD}(?:SELECT|WITH)\\b`, "i");
const LOCKING =
  /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i;

const trialKey = (queryId: string, index: string) => `${queryId}:${index}`;
const explainable = (query: QueryRecord) =>
  query.database !== undefined && EXPLAINABLE.test(query.sql);
const measurable = (query: QueryRecord) =>
  explainable(query) &&
  query.database?.provider !== "sqlite" &&
  READ.test(query.sql) &&
  !LOCKING.test(query.sql);

/** The first thing a closed row's SQL shows, under it, when it shows something. */
export function clue(view: AnalysisView, query: QueryRecord): string {
  const [first, ...rest] = [...(view.findings[query.id] ?? [])].sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity],
  );
  if (!first) return "";
  return `<div class="clue ${first.severity}">${escape(first.message)}${rest.length ? ` <span class="more">and ${rest.length} more</span>` : ""}</div>`;
}

/** The way into the code that replaces an N+1, on its closed row. */
export const fixLink = (query: QueryRecord) =>
  `<button class="explain-link" data-action="fix-open" data-id="${escape(query.id)}">Fix the N+1 ›</button>`;

/** The way into a query's plan, on its closed row, when the database can be asked about it. */
export function explainLink(query: QueryRecord): string {
  return explainable(query)
    ? `<button class="explain-link" data-action="explain-open" data-id="${escape(query.id)}">Explain ›</button>`
    : "";
}

/** The tools row under an open query, the table's whole width; an N+1's starts with its fix. */
export function toolsRow(
  view: AnalysisView,
  query: QueryRecord,
  times: number,
  root: string,
): string {
  const id = escape(query.id);
  const active = view.tabs[query.id];
  const tab = (name: QueryTab, label: string, hint: string) =>
    `<button class="qtab${active === name ? " on" : ""}" data-action="query-tab" data-tab="${name}" data-id="${id}">${label}<small>${hint}</small></button>`;
  const best =
    view.fixes && "fixes" in view.fixes ? view.fixes.fixes[query.id]?.options[0] : undefined;
  const tabs = [
    times > 1 ? tab("fix", "Fix the N+1", best ? saved(best) : "") : "",
    explainable(query) ? tab("explain", "Explain plan", "estimated") : "",
    measurable(query)
      ? tab(
          "measure",
          "Measure it",
          active === "measure" ? "ran it, rolled back" : "runs it, rolled back",
        )
      : "",
  ].join("");
  const strip = `<div class="qtabs">${tabs}<span class="spacer"></span><button class="link" data-action="copy" data-id="${id}">Copy runnable SQL</button><button class="close" data-action="query-close" data-id="${id}">Close ✕</button></div>`;
  const body = active === "fix" ? fixPane(view, query, root) : pane(view, query, times);
  return `<tr class="tools"><td></td><td colspan="4">${strip}${body}</td></tr>`;
}

const saved = (option: FixOption) =>
  `${count(option.queries, "query", "queries")} instead of ${option.instead}`;

/** What an N+1 repeats, where its values came from, and the code that replaces the loop. */
function fixPane(view: AnalysisView, query: QueryRecord, root: string): string {
  const state = view.fixes;
  if (!state || "loading" in state) return `<div class="said">Reading the loop…</div>`;
  if ("error" in state)
    return `<div class="said">Couldn't read the loop: ${escape(state.error)}</div>`;
  const fix = state.fixes[query.id];
  if (!fix) return `<div class="said">No fix is known for this one.</div>`;
  const place = (frame: StackFrame | undefined, lead: string) =>
    frame ? `${lead}${escape(shortPath(frame.file, root))}:${frame.line}` : "";
  const { varying, source } = fix;
  const values =
    varying &&
    `${varying.values.map((value) => escape(JSON.stringify(value))).join(", ")}${varying.count > varying.values.length ? ", …" : ""}`;
  const said = [
    `<b>${escape(fix.operation)}</b> ran ${fix.times} times${place(fix.origin, " from ")}`,
    varying ? `, once for each <span class="mono">${escape(varying.path)}</span>: ${values}.` : ".",
    source
      ? ` They are the ${source.rows} rows <b>${escape(source.operation)}</b> read just before${place(source.origin, ", at ")}${fix.relation ? `: ${escape(fix.relation)} in your schema` : ""}.`
      : "",
  ].join("");
  const options = fix.options.map(
    (option) => `<div class="h">${escape(option.title)}<small>${saved(option)}</small></div>
      <pre class="fix-code">${option.lines.map((line) => `<span${line.added ? ' class="added"' : ""}>${codeHtml(line.text)}</span>`).join("\n")}</pre>
      <div class="after"><span>${escape(option.note ?? "")}</span>${copyButton(option.lines.map((line) => line.text).join("\n"))}</div>`,
  );
  return `<div class="said"><span>${said}</span></div>${fix.note ? `<div class="said"><span>${escape(fix.note)}</span></div>` : ""}${options.join("")}`;
}

// Strings and comments of a fix's code, in their colours.
const codeHtml = (text: string) =>
  text
    .split(/("(?:[^"\\]|\\.)*"|\/\*.*?\*\/|\/\/.*$)/)
    .map((part, index) =>
      index % 2
        ? `<span class="${part.startsWith('"') ? "str" : "cm"}">${escape(part)}</span>`
        : escape(part),
    )
    .join("");

function pane(view: AnalysisView, query: QueryRecord, times: number): string {
  const active = view.tabs[query.id];
  if (!explainable(query))
    return `<div class="said">${query.database ? "The database has no plan for this statement." : "The connection that ran this query is not one the profiler can ask."}</div>`;
  if (!active)
    return `<div class="said">Explain plan asks the database for its estimate, without running the query. Measure it runs a read in a transaction that is rolled back.</div>`;
  const state = (active === "explain" ? view.estimates : view.measures)[query.id];
  if (!state || "loading" in state)
    return `<div class="said">${active === "measure" ? "Running it in a transaction that is rolled back…" : "Asking the database…"}</div>`;
  if ("error" in state)
    return `<div class="said">Couldn't get the plan: ${escape(state.error)}</div>`;
  const { analysis } = state;
  const plan = analysis.plan;
  const engine = `<b>${ENGINES[analysis.engine]} ${escape(analysis.version)}</b>`;
  const forWhich = times > 1 ? ` · for the first of the ${times}` : "";
  const how = !plan
    ? ""
    : plan.measured
      ? " · measured, in a transaction rolled back"
      : plan.generic
        ? " · estimated, without the parameters' values"
        : plan.approximate
          ? " · estimated, with stand-ins for hidden values"
          : " · estimated, not run";
  const rawKey = `raw:${query.id}:${active}`;
  const rawLink = plan
    ? `<button class="link" data-action="section" data-key="${escape(rawKey)}">${view.open.has(rawKey) ? "Hide the database's plan" : "Show the database's plan"}</button>`
    : "";
  const said = `<div class="said"><span>${engine}${forWhich}${how}</span>${rawLink}</div>`;
  if (!plan)
    return `${said}<div class="said">${escape(analysis.noPlan?.message ?? "No plan.")}</div>${findingsSection(view, query, analysis, active)}`;
  const flagged = new Set(analysis.findings.map((finding) => finding.step));
  const steps: string[] = [];
  let position = 0;
  const walk = (children: PlanStep[], depth: number) => {
    for (const child of children) {
      steps.push(stepHtml(child, depth, flagged.has(position)));
      position += 1;
      walk(child.children, depth + 1);
    }
  };
  walk(plan.steps, 0);
  const raw = view.open.has(rawKey) ? `<pre class="raw-plan mono">${escape(plan.raw)}</pre>` : "";
  return `${said}${raw}<div class="steps">${steps.join("")}</div>${findingsSection(view, query, analysis, active)}`;
}

function stepHtml(step: PlanStep, depth: number, flagged: boolean): string {
  const name = step.relation ?? step.table;
  const parts = [
    name ? `<b>${escape(name)}</b>` : "",
    step.index ? `<span class="detail mono">${escape(step.index)}</span>` : "",
    step.lookup ? `<span class="detail mono">${escape(step.lookup)}</span>` : "",
    step.filter ? `<span class="detail mono">filter: ${escape(step.filter)}</span>` : "",
    step.keys?.length ? `<span class="detail mono">${escape(step.keys.join(", "))}</span>` : "",
    step.temporary ? `<span class="badge plain">temporary</span>` : "",
    step.onDisk ? `<span class="badge problem">on disk</span>` : "",
  ].filter(Boolean);
  const notes = step.notes?.length
    ? `<span class="notes">${escape(step.notes.join(" · "))}</span>`
    : "";
  const measured = step.measured;
  const rows = measured
    ? `${rowCount(measured.rows)}${measured.loops > 1 ? ` · ${measured.loops} loops` : ""}${measured.ms === undefined ? "" : ` · ${ms(measured.ms)}`}`
    : step.rows === undefined
      ? ""
      : `~${rowCount(step.rows)}${step.cost === undefined ? "" : ` · cost ${round(step.cost).toLocaleString("en-US")}`}`;
  return `<div class="step${flagged ? " flagged" : ""}"><span class="tree mono" style="padding-left:${depth * 14}px">${depth ? "└─" : ""}</span>${accessBadge(step)}<span class="what">${parts.join(" ")}${notes}</span><span class="rows">${rows}</span></div>`;
}

function accessBadge(step: PlanStep): string {
  switch (step.access) {
    case "full":
      return `<span class="badge problem">Reads every row</span>`;
    case "automatic-index":
      return `<span class="badge problem">Builds an index</span>`;
    case "index-full":
      return `<span class="badge warning">Reads the whole index</span>`;
    case "index":
    case "index-only":
    case "unique":
      return `<span class="badge index">Uses index</span>`;
    default:
      return `<span class="badge plain">${escape(step.label)}</span>`;
  }
}

function findingsSection(
  view: AnalysisView,
  query: QueryRecord,
  analysis: Analysis,
  tab: QueryTab,
): string {
  const own = analysis.findings.filter((finding) => finding.about === "query");
  const tables = analysis.findings.filter((finding) => finding.about === "table");
  const names = [...new Set(tables.map((finding) => finding.table).filter(Boolean))];
  const tableKey = `table:${query.id}:${tab}`;
  const findings = own.length
    ? `<div class="h">What it finds</div>${own.map((finding, at) => findingHtml(view, query, analysis, finding, `${tab}${at}`)).join("")}`
    : `<div class="said">Nothing to fix in how it reads.</div>`;
  const fold = tables.length
    ? `<div class="fold"><button class="link" data-action="section" data-key="${escape(tableKey)}">${view.open.has(tableKey) ? "▾" : "▸"}</button> <b>About the table${names.length > 1 ? "s" : ""} ${escape(names.join(", "))}</b> · ${tables.length} note${tables.length > 1 ? "s" : ""}, whatever the query <button class="link" data-action="section" data-key="${escape(tableKey)}">${view.open.has(tableKey) ? "Hide" : "Show"}</button></div>${view.open.has(tableKey) ? tables.map((finding, at) => findingHtml(view, query, analysis, finding, `${tab}t${at}`)).join("") : ""}`
    : "";
  return findings + fold;
}

function findingHtml(
  view: AnalysisView,
  query: QueryRecord,
  analysis: Analysis,
  finding: Finding,
  key: string,
): string {
  const docs = finding.docs
    ? `<a class="docs" href="${escape(finding.docs)}" target="_blank" rel="noopener">${ENGINES[analysis.engine]} manual</a>`
    : "<span></span>";
  return `<div class="find"><span><span class="badge ${finding.severity}">${finding.severity}</span></span><div class="what"><span class="msg">${escape(finding.message)}</span>${fixHtml(view, query, analysis, finding, key)}</div>${docs}</div>`;
}

function fixHtml(
  view: AnalysisView,
  query: QueryRecord,
  analysis: Analysis,
  finding: Finding,
  key: string,
): string {
  const fix = finding.fix;
  if (!fix) return "";
  const sqlKey = `sql:${query.id}:${key}`;
  const shown = fix.prisma ?? fix.sql;
  const links = [
    shown ? copyButton(shown) : "",
    fix.prisma && fix.sql
      ? `<button class="link" data-action="section" data-key="${escape(sqlKey)}">${view.open.has(sqlKey) ? "Hide SQL" : "Show SQL"}</button>`
      : "",
  ];
  const triable = fix.index !== undefined && fix.sql !== undefined;
  const undoable = analysis.engine === "postgres" || analysis.engine === "sqlite";
  const trial = triable ? trialHtml(view, query, fix.index!, undoable) : { link: "", result: "" };
  const line = shown
    ? `<div class="line"><span class="mono">${escape(shown)}</span>${links.join("")}${trial.link}</div>`
    : trial.link
      ? `<div class="line">${trial.link}</div>`
      : "";
  const sql =
    fix.prisma && fix.sql && view.open.has(sqlKey)
      ? `<div class="line"><span class="mono">${escape(fix.sql)}</span>${copyButton(fix.sql)}</div>`
      : "";
  return `<span class="fix">${escape(fix.text)}</span>${line}${sql}${trial.result}`;
}

function trialHtml(
  view: AnalysisView,
  query: QueryRecord,
  index: string,
  undoable: boolean,
): { link: string; result: string } {
  if (!undoable)
    return {
      link: `<span class="sub">Try this index: MySQL and MariaDB commit a CREATE INDEX at once, so it cannot be tried and undone.</span>`,
      result: "",
    };
  const state = view.trials[trialKey(query.id, index)];
  const trying = state !== undefined && "loading" in state;
  const link = `<button class="link" data-action="trial" data-id="${escape(query.id)}" data-index="${escape(index)}"${trying ? " disabled" : ""}>${trying ? "Trying…" : "Try this index"}</button>`;
  if (!state || trying) return { link, result: "" };
  if ("error" in state)
    return {
      link,
      result: `<div class="tried failed">Couldn't try it: ${escape(state.error)}</div>`,
    };
  const { trial } = state;
  const read = firstRead(trial.plan.steps);
  const cost =
    trial.before !== undefined && trial.after !== undefined
      ? `, cost ${round(trial.before).toLocaleString("en-US")} → ${round(trial.after).toLocaleString("en-US")}`
      : "";
  const said = trial.used
    ? `✓ With the index, the database uses it${read ? `: ${escape(read.label)}` : ""}${cost}.`
    : trial.inconclusive
      ? escape(trial.inconclusive)
      : "With the index, the database still does not use it for this query.";
  const tone = trial.used ? "" : trial.inconclusive ? " inconclusive" : " unused";
  return {
    link,
    result: `<div class="tried${tone}">${said} <span class="sub">Created and rolled back in a transaction: your database is as it was.</span></div>`,
  };
}

const firstRead = (steps: PlanStep[]): PlanStep | undefined => {
  for (const step of steps) {
    if (step.kind === "read" && step.index) return step;
    const found = firstRead(step.children);
    if (found) return found;
  }
  return undefined;
};

const rowCount = (rows: number) => {
  const whole = Math.round(rows);
  return `${whole.toLocaleString("en-US")} ${whole === 1 ? "row" : "rows"}`;
};

const round = (cost: number) => (cost >= 100 ? Math.round(cost) : Math.round(cost * 100) / 100);

const copyButton = (text: string) =>
  `<button class="link" data-action="copy-text" data-copy="${escape(text)}">Copy</button>`;

export interface Where {
  base: string;
  token: string | undefined;
  /** Opens or closes a query's row. */
  expand(id: string, open: boolean): void;
  /** Shows the Queries tab, for an N+1's fix opened from Warnings. */
  toQueries?(): void;
}

/** Opens an N+1's row on its fix, asking for the profile's fixes the first time. */
export function openFix(view: AnalysisView, where: Where, id: string, rerender: () => void) {
  if (!where.token) return;
  where.toQueries?.();
  where.expand(id, true);
  view.tabs[id] = "fix";
  if (!view.fixes) void loadFixes(view, where.base, where.token, rerender);
}

/** Opens a query's row on Explain plan, asking the database the first time. */
export function openExplain(view: AnalysisView, where: Where, id: string, rerender: () => void) {
  if (!where.token) return;
  where.expand(id, true);
  view.tabs[id] = "explain";
  if (!view.estimates[id]) void ask(view, where.base, where.token, id, "explain", rerender);
}

/** What an action in a query's tools does; false when the action is none of them. */
export function planAction(
  target: HTMLElement,
  view: AnalysisView,
  where: Where,
  rerender: () => void,
): boolean {
  const id = target.dataset.id;
  const { base, token } = where;
  switch (target.dataset.action) {
    case "explain-open":
      if (id) openExplain(view, where, id, rerender);
      rerender();
      return true;
    case "fix-open":
      if (id) openFix(view, where, id, rerender);
      rerender();
      return true;
    case "query-tab": {
      const tab = target.dataset.tab as QueryTab;
      if (!id || !token) return true;
      // The open tab, pressed again, closes.
      if (view.tabs[id] === tab) delete view.tabs[id];
      else if (tab === "fix") {
        view.tabs[id] = tab;
        if (!view.fixes) void loadFixes(view, base, token, rerender);
      } else {
        view.tabs[id] = tab;
        const known = tab === "explain" ? view.estimates : view.measures;
        if (!known[id]) void ask(view, base, token, id, tab, rerender);
      }
      rerender();
      return true;
    }
    case "query-close":
      if (id) {
        delete view.tabs[id];
        where.expand(id, false);
      }
      rerender();
      return true;
    case "trial": {
      const index = target.dataset.index;
      if (!id || !token || !index) return true;
      const key = trialKey(id, index);
      view.trials[key] = { loading: true };
      rerender();
      void askProfiler<Trial | NoPlan>(`${base}/api/profiles/${token}/queries/${id}/trial`, {
        method: "POST",
        body: JSON.stringify({ index }),
      }).then((result) => {
        view.trials[key] =
          "error" in result
            ? result
            : "problem" in result.body
              ? { error: result.body.message }
              : { trial: result.body };
        rerender();
      });
      return true;
    }
    case "section": {
      const key = target.dataset.key!;
      const open = new Set(view.open);
      if (!open.delete(key)) open.add(key);
      view.open = open;
      rerender();
      return true;
    }
    case "copy-text":
      void navigator.clipboard
        .writeText(target.dataset.copy ?? "")
        .then(() => (target.textContent = "Copied"));
      return true;
    default:
      return false;
  }
}

async function loadFixes(view: AnalysisView, base: string, token: string, rerender: () => void) {
  view.fixes = { loading: true };
  rerender();
  const result = await askProfiler<Record<string, N1Fix>>(`${base}/api/profiles/${token}/fixes`);
  view.fixes = "error" in result ? result : { fixes: result.body };
  rerender();
}

async function ask(
  view: AnalysisView,
  base: string,
  token: string,
  id: string,
  tab: Exclude<QueryTab, "fix">,
  rerender: () => void,
) {
  const known = tab === "explain" ? view.estimates : view.measures;
  known[id] = { loading: true };
  const result = await askProfiler<Analysis>(
    `${base}/api/profiles/${token}/queries/${id}/analysis${tab === "measure" ? "?measure=1" : ""}`,
  );
  known[id] = "error" in result ? result : { analysis: result.body };
  rerender();
}

/** The findings of every query of a profile that need no database. */
export async function loadFindings(
  base: string,
  token: string,
): Promise<Record<string, Finding[]>> {
  try {
    const response = await fetch(`${base}/api/profiles/${token}/findings`, {
      headers: { Accept: "application/json" },
    });
    return response.ok ? ((await response.json()) as Record<string, Finding[]>) : {};
  } catch {
    return {};
  }
}
