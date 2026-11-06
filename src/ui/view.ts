import type { Profile, ProfileListItem } from "../core/index.js";
import type { AnalysisView } from "./analysis.js";
import { LOGO } from "./brand.js";
import { count } from "./count.js";
import { detail, tabLabel, type DetailTab } from "./detail.js";
import { escape, fromRequest, kindPill, ms, type Editor } from "./format.js";
import { themeSwitch, type Theme } from "./theme.js";

export type Tab = "requests" | DetailTab;

export interface ViewState {
  base: string;
  root: string;
  editor: Editor;
  /** The page shown: the document, or the navigation that replaced it. */
  page?: ProfileListItem;
  /** The calls the page made, oldest first. */
  calls: ProfileListItem[];
  /** The request the detail tabs show, whole. */
  profile?: Profile;
  recent: ProfileListItem[];
  open: boolean;
  minimized: boolean;
  showRecent: boolean;
  pinned: boolean;
  tab: Tab;
  height: number;
  expanded: ReadonlySet<string>;
  analysis: AnalysisView;
  theme: Theme;
}

export function render(state: ViewState): string {
  if (state.minimized) return pill(state);
  return [state.open ? panel(state) : "", strip(state), state.showRecent ? recent(state) : ""].join(
    "",
  );
}

/** The page and its calls, added up. */
export function totals(state: Pick<ViewState, "page" | "calls">) {
  const all = state.page ? [state.page, ...state.calls] : state.calls;
  return {
    requests: all.length,
    queries: all.reduce((sum, item) => sum + item.summary.queryCount, 0),
    dbTimeMs: all.reduce((sum, item) => sum + item.summary.dbTimeMs, 0),
    warnings: all.reduce((sum, item) => sum + item.warningCount, 0),
    errors: all.reduce((sum, item) => sum + item.summary.errorCount, 0),
  };
}

function strip(state: ViewState): string {
  const { page } = state;
  const sum = totals(state);
  const summary = page
    ? `${kindPill(page)}
       <span class="url">${escape(page.request.url)}</span>
       ${state.calls.length ? `<span><b>${state.calls.length}</b> ${state.calls.length === 1 ? "call" : "calls"}</span>` : ""}
       <span><b>${sum.queries}</b> queries</span>
       <span><b>${ms(sum.dbTimeMs)}</b> in DB</span>
       ${sum.warnings ? `<span><i class="dot"></i>${count(sum.warnings, "warning")}</span>` : ""}
       ${sum.errors ? `<span><i class="dot bad"></i>${count(sum.errors, "error")}</span>` : ""}`
    : `<span class="url">No profile for this page yet</span>`;
  return `<div class="strip">
    <button class="summary" data-action="toggle" aria-expanded="${state.open}" title="${state.open ? "Close" : "Open"} the database profiler">${summary}</button>
    ${state.pinned ? `<button class="chip" data-action="follow">Back to this page</button>` : ""}
    <button class="chip${state.showRecent ? " on" : ""}" data-action="recent">Recent (${state.recent.length})</button>
    ${themeSwitch(state.theme)}
    <span class="brand">${LOGO}Query Profiler</span>
    <button class="chip" data-action="minimize" title="Minimize" aria-label="Minimize">▾</button>
  </div>`;
}

function pill(state: ViewState): string {
  const sum = totals(state);
  return `<button class="pill" data-action="restore" title="Open the database profiler">${LOGO}${
    state.page ? `<b>${sum.queries}</b> queries · ${ms(sum.dbTimeMs)}` : "Query Profiler"
  }${sum.warnings ? ` · <i class="dot"></i>${sum.warnings}` : ""}</button>`;
}

function recent(state: ViewState): string {
  const head = `<div class="recent-head"><b>Recent</b>${state.recent.length ? `<button type="button" class="clear" data-action="clear" title="Remove every stored request">Clear</button>` : ""}</div>`;
  if (!state.recent.length)
    return `<div class="recent">${head}<div class="empty">No requests yet</div></div>`;
  return `<div class="recent">${head}${state.recent
    .map(
      (
        item,
      ) => `<button data-action="pick" data-token="${escape(item.token)}" class="${item.token === state.profile?.token ? "on" : ""}">
        ${kindPill(item)} ${escape(item.request.url)}
        <div class="sub">${fromRequest(item) ? `${item.kind} · ` : ""}${count(item.summary.queryCount, "query", "queries")} · ${ms(item.summary.dbTimeMs)}${item.warningCount ? ` · ${count(item.warningCount, "warning")}` : ""}</div>
      </button>`,
    )
    .join("")}</div>`;
}

const TABS: [Tab, string][] = [
  ["requests", "Requests"],
  ["queries", "Queries"],
  ["operations", "Operations"],
  ["timeline", "Timeline"],
  ["warnings", "Warnings"],
  ["request", "Request"],
];

function panel(state: ViewState): string {
  const { profile } = state;
  const counts: Partial<Record<Tab, number>> = {
    ...(state.page ? { requests: 1 + state.calls.length } : {}),
    ...(profile
      ? {
          queries: profile.queries.length,
          operations: profile.operations.length,
          warnings: profile.warnings.length,
        }
      : {}),
  };
  const tabs = TABS.map(
    ([tab, label]) =>
      `<button class="tab${state.tab === tab ? " on" : ""}" data-action="tab" data-tab="${tab}">${profile ? tabLabel(profile, tab, label) : label}${counts[tab] === undefined ? "" : ` (${counts[tab]})`}</button>`,
  ).join("");
  const json = profile
    ? `<a href="${escape(`${state.base}/${profile.token}`)}" target="_blank" rel="noopener">Open full profile</a>`
    : "";
  return `<div class="panel" style="height:${state.height}px">
    <div class="handle" data-drag title="Drag to resize"></div>
    <div class="tabs">${tabs}<span class="spacer"></span>${json}</div>
    <div class="body">${state.tab === "requests" ? requestsTab(state) : profile ? body(state, profile) : `<div class="empty">Open a page or run a request to see what the database did.</div>`}</div>
  </div>`;
}

type Place = "page" | "call" | "last call";

function requestRow(state: ViewState, item: ProfileListItem, place: Place): string {
  const on = item.token === state.profile?.token;
  const call = place !== "page";
  // A call hangs from the page's line: a branch and a dot, the line ending at the last call.
  const branch = call
    ? `<span class="branch${place === "last call" ? " last" : ""}"><i></i></span>`
    : "";
  return `<tr class="${call ? "child" : "main"}${on ? " on" : ""}" data-action="select" data-token="${escape(item.token)}">
    <td>${branch}${kindPill(item)}</td>
    <td><span class="mono">${escape(item.request.url)}</span><div class="sub">${item.kind}${item.warningCount ? ` · <i class="dot"></i>${count(item.warningCount, "warning")}` : ""}</div></td>
    <td>${count(item.summary.queryCount, "query", "queries")}</td>
    <td class="dur">${ms(item.summary.dbTimeMs)}<div class="sub">${ms(item.durationMs)} total</div></td>
  </tr>`;
}

function requestsTab(state: ViewState): string {
  if (!state.page) return `<div class="empty">No profile for this page yet.</div>`;
  const rows = [
    requestRow(state, state.page, "page"),
    ...state.calls.map((call, index) =>
      requestRow(state, call, index === state.calls.length - 1 ? "last call" : "call"),
    ),
  ];
  return `<table class="requests"><thead><tr><th>Request</th><th>URL</th><th>Queries</th><th>In DB</th></tr></thead><tbody>${rows.join("")}</tbody></table>
    <div class="hint">The page and the calls it made. Pick one to see its queries.</div>`;
}

function body(state: ViewState, profile: Profile): string {
  return state.tab === "requests" ? requestsTab(state) : detail(state, profile, state.tab);
}
