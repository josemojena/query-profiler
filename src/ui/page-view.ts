import type { Profile, ProfileListItem, StatementStat, Stats } from "../core/index.js";
import { LOGO } from "./brand.js";
import { count } from "./count.js";
import { detail, type Detail, type DetailTab } from "./detail.js";
import { escape, ms, statusTone } from "./format.js";
import { sessionSection, type SessionView } from "./session.js";
import { themeSwitch, type Theme } from "./theme.js";

export interface PageState extends Detail {
  list: ProfileListItem[];
  filter: string;
  view: "requests" | "stats";
  profile?: Profile;
  tab: DetailTab;
  stats?: Stats;
  /** The session's analysis, kept while the page is open. */
  session: SessionView;
  theme: Theme;
}

const TABS: [DetailTab, string][] = [
  ["queries", "Queries"],
  ["operations", "Operations"],
  ["timeline", "Timeline"],
  ["warnings", "Warnings"],
  ["request", "Request"],
];

export function renderPage(state: PageState): string {
  return `<div class="app">
    <aside class="side">
      <div class="brand-row">${LOGO}Query Profiler<span class="spacer"></span>${themeSwitch(state.theme)}</div>
      <nav class="switch">
        <a href="${escape(state.base)}" data-action="go" class="${state.view === "requests" ? "on" : ""}">Requests</a>
        <a href="${escape(`${state.base}/stats`)}" data-action="go" class="${state.view === "stats" ? "on" : ""}">Stats</a>
        <button type="button" class="clear" data-action="clear" title="Remove every stored request">Clear</button>
      </nav>
      <input class="filter" type="search" placeholder="Filter by path or status" aria-label="Filter requests" value="${escape(state.filter)}">
      <nav class="list">${renderList(state)}</nav>
    </aside>
    <main class="main page">${state.view === "stats" ? statsView(state) : state.profile ? profileView(state, state.profile) : `<div class="empty">No requests yet. Open a page of your app.</div>`}</main>
  </div>`;
}

/** Pages newest first, each with its calls under it; a filter keeps a page when it or a call matches. */
export function tree(
  list: ProfileListItem[],
  filter: string,
): [ProfileListItem, ProfileListItem[]][] {
  const tokens = new Set(list.map((item) => item.token));
  const roots = list.filter((item) => !item.parentToken || !tokens.has(item.parentToken));
  const needle = filter.trim().toLowerCase();
  const matches = (item: ProfileListItem) =>
    !needle ||
    item.request.url.toLowerCase().includes(needle) ||
    String(item.response?.status ?? "").startsWith(needle);
  return roots
    .map((root): [ProfileListItem, ProfileListItem[]] => [
      root,
      list.filter((item) => item.parentToken === root.token).reverse(),
    ])
    .filter(([root, calls]) => matches(root) || calls.some(matches));
}

export function renderList(state: PageState): string {
  const groups = tree(state.list, state.filter);
  if (!groups.length) return `<div class="empty">Nothing matches.</div>`;
  const item = (entry: ProfileListItem, child: boolean) => {
    const on = entry.token === state.profile?.token && state.view === "requests";
    return `<a href="${escape(`${state.base}/${entry.token}`)}" data-action="go" class="item${child ? " child" : ""}${on ? " on" : ""}">
      ${child ? `<i class="node"></i>` : ""}<b>${escape(entry.request.method)} ${entry.response?.status ?? "…"}</b> <span class="mono">${escape(entry.request.url)}</span>
      <div class="sub">${entry.kind} · ${count(entry.summary.queryCount, "query", "queries")} · ${ms(entry.summary.dbTimeMs)}${entry.warningCount ? ` · <i class="dot"></i>${count(entry.warningCount, "warning")}` : ""}</div>
    </a>`;
  };
  const calls = (entries: ProfileListItem[]) =>
    entries.length
      ? `<ul class="calls-tree">${entries.map((call) => `<li>${item(call, true)}</li>`).join("")}</ul>`
      : "";
  return groups
    .map(([root, entries]) => `<div class="group">${item(root, false)}${calls(entries)}</div>`)
    .join("");
}

function profileView(state: PageState, profile: Profile): string {
  const parent = state.list.find((item) => item.token === profile.parentToken);
  const calls = state.list.filter((item) => item.parentToken === profile.token).reverse();
  const time = new Date(profile.startedAt).toLocaleTimeString();
  const counts: Partial<Record<DetailTab, number>> = {
    queries: profile.queries.length,
    operations: profile.operations.length,
    warnings: profile.warnings.length,
  };
  const tabs = TABS.map(
    ([tab, label]) =>
      `<button class="tab${state.tab === tab ? " on" : ""}" data-action="tab" data-tab="${tab}">${label}${counts[tab] === undefined ? "" : ` (${counts[tab]})`}</button>`,
  ).join("");
  return `<header class="head">
      <div>
        <h1>${escape(profile.request.method)} ${escape(profile.request.url)} · <span class="status tone-${statusTone(profile.response?.status)}">${profile.response?.status ?? "…"}</span> · ${ms(profile.durationMs)}</h1>
        <div class="sub">token <span class="mono">${escape(profile.token)}</span> · ${escape(time)} · ${profile.kind}${parent ? ` · called from <a href="${escape(`${state.base}/${parent.token}`)}" data-action="go">${escape(parent.request.url)}</a>` : ""}</div>
      </div>
      <a class="button" href="${escape(`${state.base}/api/profiles/${profile.token}`)}" download="query-profiler-${escape(profile.token)}.json">Download JSON</a>
    </header>
    <div class="cards">
      <div class="card"><b>${profile.summary.queryCount}</b>queries</div>
      <div class="card"><b>${ms(profile.summary.dbTimeMs)}</b>in the database</div>
      <div class="card"><b>${profile.summary.operationCount}</b>operations</div>
      <div class="card${profile.warnings.length ? " warn" : ""}"><b>${profile.warnings.length}</b>${profile.warnings.length ? `warnings: ${escape([...new Set(profile.warnings.map((w) => (w.kind === "n+1" ? "N+1" : w.kind)))].join(", "))}` : "warnings"}</div>
    </div>
    ${calls.length ? `<h2>Calls from this page</h2><div class="calls">${calls.map((call) => `<a href="${escape(`${state.base}/${call.token}`)}" data-action="go">${escape(call.request.method)} ${escape(call.request.url)} · ${count(call.summary.queryCount, "query", "queries")}</a>`).join("")}</div>` : ""}
    <div class="tabs">${tabs}</div>
    <div class="content">${detail(state, profile, state.tab)}</div>`;
}

function statementRows(state: PageState, rows: StatementStat[]): string {
  if (!rows.length) return `<div class="empty">No queries yet.</div>`;
  return `<table><thead><tr><th>SQL</th><th>Runs</th><th>Slowest</th><th>Total</th><th></th></tr></thead><tbody>${rows
    .map(
      (row) => `<tr>
        <td><div class="sql mono clip">${escape(row.sql)}</div></td>
        <td>${row.count}</td>
        <td class="dur">${ms(row.maxMs)}</td>
        <td class="dur">${ms(row.totalMs)}</td>
        <td class="origin"><a href="${escape(`${state.base}/${row.token}`)}" data-action="go">profile</a></td>
      </tr>`,
    )
    .join("")}</tbody></table>`;
}

function statsView(state: PageState): string {
  const { stats } = state;
  if (!stats) return `<div class="empty">Loading…</div>`;
  return `<header class="head"><div><h1>Stats</h1><div class="sub">Across the last ${count(stats.profiles, "request")}.</div></div></header>
    ${sessionSection(state.session, state.base, stats.profiles)}
    <h2>Slowest statements</h2>${statementRows(state, stats.slowest)}
    <h2>Most repeated statements</h2>${statementRows(state, stats.repeated)}
    <h2>By model</h2><table><thead><tr><th>Model</th><th>Operations</th><th>Time</th></tr></thead><tbody>${stats.models
      .map(
        (row) =>
          `<tr><td><b>${escape(row.model)}</b></td><td>${row.operations}</td><td class="dur">${ms(row.totalMs)}</td></tr>`,
      )
      .join("")}</tbody></table>
    <h2>By route</h2><table><thead><tr><th>Path</th><th>Requests</th><th>Queries</th><th>In the database</th><th>Warnings</th></tr></thead><tbody>${stats.routes
      .map(
        (row) =>
          `<tr><td class="mono">${escape(row.path)}</td><td>${row.requests}</td><td>${row.queries}</td><td class="dur">${ms(row.dbTimeMs)}</td><td>${row.warnings}</td></tr>`,
      )
      .join("")}</tbody></table>`;
}
