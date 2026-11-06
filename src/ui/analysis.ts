import type { Analysis, Finding, Trial } from "../analysis/analyze.js";
import type { NoPlan } from "../analysis/explain.js";
import type { Engine, PlanStep } from "../analysis/plan.js";
import type { QueryRecord } from "../core/index.js";
import { escape, ms } from "./format.js";

// The plan of a query and what the analysis finds in it, inside the query's open row.

export type PlanState =
  | { loading: true; measure: boolean }
  | { analysis: Analysis }
  | { error: string };

export type TrialState = { loading: true } | { trial: Trial } | { error: string };

export interface AnalysisView {
  /** What each query's SQL shows without asking the database, by query id. */
  findings: Record<string, Finding[]>;
  /** The plans asked for, by query id. */
  plans: Record<string, PlanState>;
  /** The indexes tried, by query id and index name. */
  trials: Record<string, TrialState>;
  /** Sections opened: a fix's SQL, a table's notes, the database's own plan. */
  open: ReadonlySet<string>;
}

export const emptyAnalysis = (): AnalysisView => ({
  findings: {},
  plans: {},
  trials: {},
  open: new Set(),
});

// Same as the core's ANALYSIS_HEADER: the UI's files are served on their own and import none of it.
const HEADER = "X-Query-Profiler";
const ENGINES: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
};
const SEVERITY = { problem: 0, warning: 1, info: 2 };
const READ = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*\(?\s*(?:SELECT|WITH)\b/i;
const LOCKING =
  /\bFOR\s+(?:NO\s+KEY\s+)?(?:UPDATE|SHARE|KEY\s+SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i;

const trialKey = (queryId: string, index: string) => `${queryId}:${index}`;

/** The first thing a closed row's SQL shows, under it, when it shows something. */
export function clue(view: AnalysisView, query: QueryRecord): string {
  const [first, ...rest] = [...(view.findings[query.id] ?? [])].sort(
    (a, b) => SEVERITY[a.severity] - SEVERITY[b.severity],
  );
  if (!first) return "";
  return `<div class="clue ${first.severity}">${escape(first.message)}${rest.length ? ` <span class="more">and ${rest.length} more</span>` : ""}</div>`;
}

/** The actions of an open row: explain, measure, and the plan below them. */
export function planActions(view: AnalysisView, query: QueryRecord): string {
  const state = view.plans[query.id];
  const reads = READ.test(query.sql) && !LOCKING.test(query.sql);
  const measurable = reads && query.database?.provider !== "sqlite";
  return [
    query.database
      ? `<button data-action="explain" data-id="${escape(query.id)}" class="${state ? "on" : ""}">${state ? "Hide plan" : "Explain plan"}</button>`
      : "",
    measurable && query.database
      ? `<button data-action="measure" data-id="${escape(query.id)}" title="Runs the read in a transaction that is rolled back">Measure it</button>`
      : "",
  ].join("");
}

/** The plan box under an open row, once a plan is asked for. */
export function planBox(view: AnalysisView, query: QueryRecord, times: number): string {
  const state = view.plans[query.id];
  if (!state) return "";
  if ("loading" in state)
    return `<div class="plan"><div class="plan-head"><span><b>Plan</b></span><span>${state.measure ? "running it in a transaction that is rolled back…" : "asking the database…"}</span></div></div>`;
  if ("error" in state)
    return `<div class="plan"><div class="plan-head"><span><b>Plan</b></span></div><div class="finding"><span class="caveat">Couldn't get the plan: ${escape(state.error)}</span></div></div>`;
  const { analysis } = state;
  const engine = `${ENGINES[analysis.engine]} ${escape(analysis.version)}`;
  const forWhich = times > 1 ? ` · for the first of the ${times}` : "";
  const plan = analysis.plan;
  const how = plan
    ? plan.measured
      ? "measured, in a transaction rolled back"
      : plan.generic
        ? "estimated, without the parameters' values"
        : plan.approximate
          ? "estimated, with stand-ins for hidden values"
          : "estimated, not run"
    : "";
  const head = `<div class="plan-head"><span><b>Plan</b> · ${engine}${forWhich}</span><span>${how}</span></div>`;
  if (!plan)
    return `<div class="plan">${head}<div class="finding"><span class="caveat">${escape(analysis.noPlan?.message ?? "No plan.")}</span></div>${findingsHtml(view, query, analysis, "query")}</div>`;
  const flagged = new Set(analysis.findings.map((finding) => finding.step));
  const rows: string[] = [];
  let position = 0;
  const walk = (steps: PlanStep[], depth: number) => {
    for (const step of steps) {
      rows.push(stepHtml(step, depth, flagged.has(position)));
      position += 1;
      walk(step.children, depth + 1);
    }
  };
  walk(plan.steps, 0);
  const tables = analysis.findings.filter((finding) => finding.about === "table");
  const names = [...new Set(tables.map((finding) => finding.table).filter(Boolean))];
  const tableKey = `table:${query.id}`;
  const rawKey = `raw:${query.id}`;
  const about = tables.length
    ? `<div class="about"><span><b>About the table${names.length > 1 ? "s" : ""} ${escape(names.join(", "))}</b> · ${tables.length} note${tables.length > 1 ? "s" : ""}, whatever the query</span><button data-action="section" data-key="${escape(tableKey)}">${view.open.has(tableKey) ? "Hide" : "Show"}</button></div>${view.open.has(tableKey) ? findingsHtml(view, query, analysis, "table") : ""}`
    : "";
  const raw = view.open.has(rawKey) ? `<pre class="raw-plan mono">${escape(plan.raw)}</pre>` : "";
  return `<div class="plan">${head}<div class="steps">${rows.join("")}</div>${findingsHtml(view, query, analysis, "query")}${about}<div class="raw"><button data-action="section" data-key="${escape(rawKey)}">${view.open.has(rawKey) ? "Hide the database's plan" : "Show the database's plan"}</button></div>${raw}</div>`;
}

function stepHtml(step: PlanStep, depth: number, flagged: boolean): string {
  const name = step.relation ?? step.table;
  const parts = [
    name ? `<b>${escape(name)}</b>` : "",
    step.index ? `<span class="label mono">${escape(step.index)}</span>` : "",
    step.lookup ? `<span class="label mono">${escape(step.lookup)}</span>` : "",
    step.filter ? `<span class="label mono">filter: ${escape(step.filter)}</span>` : "",
    step.keys?.length ? `<span class="label mono">${escape(step.keys.join(", "))}</span>` : "",
    step.temporary ? `<span class="how plain">temporary</span>` : "",
    step.onDisk ? `<span class="how scan">on disk</span>` : "",
  ].filter(Boolean);
  const measured = step.measured;
  const rows = measured
    ? `${rowCount(measured.rows)}${measured.loops > 1 ? ` · ${measured.loops} loops` : ""}${measured.ms === undefined ? "" : ` · ${ms(measured.ms)}`}`
    : step.rows === undefined
      ? ""
      : `~${rowCount(step.rows)}`;
  return `<div class="step${flagged ? " flagged" : ""}" style="padding-left:${depth * 14}px"><span class="tree mono">${depth ? "└─" : ""}</span>${accessBadge(step)}<span class="what">${parts.join(" ")}</span><span class="rows">${rows}</span></div>`;
}

function accessBadge(step: PlanStep): string {
  switch (step.access) {
    case "full":
      return `<span class="how scan">Reads every row</span>`;
    case "automatic-index":
      return `<span class="how scan">Builds an index</span>`;
    case "index-full":
      return `<span class="how warn">Reads the whole index</span>`;
    case "index":
    case "index-only":
    case "unique":
      return `<span class="how index">Uses index</span>`;
    default:
      return `<span class="how plain">${escape(step.label)}</span>`;
  }
}

function findingsHtml(
  view: AnalysisView,
  query: QueryRecord,
  analysis: Analysis,
  about: Finding["about"],
): string {
  return analysis.findings
    .filter((finding) => finding.about === about)
    .map((finding, index) => {
      const docs = finding.docs
        ? `<a class="docs" href="${escape(finding.docs)}" target="_blank" rel="noopener">${ENGINES[analysis.engine]} manual</a>`
        : "";
      return `<div class="finding"><div class="finding-head"><span class="sev ${finding.severity}">${finding.severity}</span><span class="msg">${escape(finding.message)}</span>${docs}</div>${fixHtml(view, query, analysis, finding, `${about}${index}`)}</div>`;
    })
    .join("");
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
  const prisma = fix.prisma ? codeHtml(fix.prisma) : "";
  const sql = fix.sql && (view.open.has(sqlKey) || !fix.prisma) ? codeHtml(fix.sql) : "";
  const showSql =
    fix.sql && fix.prisma
      ? `<button data-action="section" data-key="${escape(sqlKey)}">${view.open.has(sqlKey) ? "Hide SQL" : "Show SQL"}</button>`
      : "";
  const triable = fix.index !== undefined && fix.sql !== undefined;
  const undoable = analysis.engine === "postgres" || analysis.engine === "sqlite";
  const trial = triable ? trialHtml(view, query, fix.index!, undoable) : { button: "", result: "" };
  const actions = [trial.button, showSql].filter(Boolean).join("");
  return `<div class="fix"><span class="text">${escape(fix.text)}</span>${prisma}${sql}${actions ? `<div class="fix-actions">${actions}</div>` : ""}${trial.result}</div>`;
}

function trialHtml(
  view: AnalysisView,
  query: QueryRecord,
  index: string,
  undoable: boolean,
): { button: string; result: string } {
  if (!undoable)
    return {
      button: `<button class="try" disabled>Try this index</button><span class="caveat">MySQL and MariaDB commit a CREATE INDEX at once, so it cannot be tried and undone.</span>`,
      result: "",
    };
  const state = view.trials[trialKey(query.id, index)];
  const button = `<button class="try" data-action="trial" data-id="${escape(query.id)}" data-index="${escape(index)}"${state && "loading" in state ? " disabled" : ""}>${state && "loading" in state ? "Trying…" : "Try this index"}</button>`;
  if (!state || "loading" in state) return { button, result: "" };
  if ("error" in state)
    return {
      button,
      result: `<div class="trial failed">Couldn't try it: ${escape(state.error)}</div>`,
    };
  const { trial } = state;
  const read = trial.plan.steps.length ? firstRead(trial.plan.steps) : undefined;
  const cost =
    trial.before !== undefined && trial.after !== undefined
      ? `, cost ${round(trial.before)} → ${round(trial.after)}`
      : "";
  const said = trial.used
    ? `With the index, the database uses it${read ? `: ${escape(read.label)}` : ""}${cost}.`
    : "With the index, the database still does not use it for this query.";
  return {
    button,
    result: `<div class="trial${trial.used ? "" : " unused"}"><b>${said}</b><span class="sub">Created and rolled back in a transaction: your database is as it was.</span></div>`,
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

const codeHtml = (text: string) =>
  `<div class="code"><span class="mono">${escape(text)}</span><button data-action="copy-text" data-copy="${escape(text)}">Copy</button></div>`;

/** What an action in the plan box does; false when the action is none of them. */
export function planAction(
  target: HTMLElement,
  view: AnalysisView,
  where: { base: string; token: string | undefined; queries: QueryRecord[] },
  rerender: () => void,
): boolean {
  const id = target.dataset.id;
  const { base, token } = where;
  switch (target.dataset.action) {
    case "explain": {
      if (!id || !token) return true;
      if (view.plans[id]) {
        delete view.plans[id];
        rerender();
      } else void ask(view, base, token, id, false, rerender);
      return true;
    }
    case "measure":
      if (id && token) void ask(view, base, token, id, true, rerender);
      return true;
    case "trial": {
      const index = target.dataset.index;
      if (!id || !token || !index) return true;
      const key = trialKey(id, index);
      view.trials[key] = { loading: true };
      rerender();
      void call<Trial | NoPlan>(`${base}/api/profiles/${token}/queries/${id}/trial`, {
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

async function ask(
  view: AnalysisView,
  base: string,
  token: string,
  id: string,
  measure: boolean,
  rerender: () => void,
) {
  view.plans[id] = { loading: true, measure };
  rerender();
  const result = await call<Analysis>(
    `${base}/api/profiles/${token}/queries/${id}/analysis${measure ? "?measure=1" : ""}`,
  );
  view.plans[id] = "error" in result ? result : { analysis: result.body };
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

async function call<T>(
  url: string,
  init: RequestInit = {},
): Promise<{ body: T } | { error: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json", [HEADER]: "1" },
    });
    const body = (await response.json().catch(() => ({}))) as T & {
      message?: string;
      error?: string;
    };
    if (response.ok) return { body };
    return {
      error: body.message ?? `the profiler answered ${response.status} (${body.error ?? "error"})`,
    };
  } catch {
    return { error: "the profiler could not be reached." };
  }
}
