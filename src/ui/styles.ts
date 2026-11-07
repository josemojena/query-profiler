export const STRIP_HEIGHT = 34;

// Night, signal blue, amber only where the profiler warns: the website's palette, and the default.
const DARK = `
  --bg: #0d0f14; --chrome: #131722; --ink: #e6e9f2; --ink-2: #9aa3b8; --ink-3: #7f889c; --line: #252b3a;
  --accent: #7c9cff; --ok: #7ee2a8; --ok-soft: #0f2a1b; --bad: #ff8a80; --bad-soft: #3b0d0d;
  --warn: #f5b041; --warn-soft: #2a1f0a; --warn-row: #17140c; --bar: #7c9cff;
  --warn-mark: #f5b041; --bad-mark: #ff8a80; --shadow: 0 -8px 24px rgb(0 0 0 / 0.45);
  color-scheme: dark;`;

const LIGHT = `
  --bg: #ffffff; --chrome: #f5f6f9; --ink: #0d0f14; --ink-2: #4a5263; --ink-3: #7f889c; --line: #e3e6ee;
  --accent: #2f52d6; --ok: #146c43; --ok-soft: #dcf5e6; --bad: #b42318; --bad-soft: #fde4e1;
  --warn: #9a5800; --warn-soft: #fbf0dc; --warn-row: #fffaf0; --bar: #2f52d6;
  --warn-mark: #f59e0b; --bad-mark: #dc2626; --shadow: 0 -8px 24px rgb(13 15 20 / 0.08);
  color-scheme: light;`;

export const styles = `
:host {${DARK}
  all: initial;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
}
:host([data-theme="light"]) {${LIGHT}
}
@media (prefers-color-scheme: light) {
  :host([data-theme="system"]) {${LIGHT}
  }
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }

.strip {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483600;
  height: ${STRIP_HEIGHT}px; display: flex; align-items: center; gap: 18px;
  padding: 0 12px; background: var(--chrome); border-top: 1px solid var(--line);
  user-select: none; white-space: nowrap;
}
.summary { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; gap: 18px; text-align: left; }
.strip .url { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; max-width: 32vw; }
.strip b { font-weight: 650; }
.spacer { flex: 1; }
.status { padding: 2px 10px; border-radius: 999px; font-weight: 650; font-size: 12px; }
.tone-ok { background: var(--ok-soft); color: var(--ok); }
.tone-warn { background: var(--warn-soft); color: var(--warn); }
.tone-bad { background: var(--bad-soft); color: var(--bad); }
.tone-muted { background: var(--line); color: var(--ink-2); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warn-mark); margin-right: 6px; vertical-align: 1px; }
.dot.bad { background: var(--bad-mark); }
.chip { color: var(--ink-2); padding: 3px 8px; border-radius: 6px; }
.chip:hover, .chip.on { background: var(--line); color: var(--ink); }
.brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; color: var(--ink-2); }
.brand svg { width: 15px; height: 15px; }
.themes { display: inline-flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; font-weight: 500; }
.themes button { padding: 1px 8px; font-size: 11.5px; color: var(--ink-2); }
.themes button + button { border-left: 1px solid var(--line); }
.themes button:hover { color: var(--ink); }
.themes button.on { background: var(--line); color: var(--ink); }

.panel {
  position: fixed; left: 0; right: 0; bottom: ${STRIP_HEIGHT}px; z-index: 2147483500;
  display: flex; flex-direction: column; background: var(--bg);
  border-top: 1px solid var(--line); box-shadow: var(--shadow);
}
.handle { height: 10px; cursor: ns-resize; display: grid; place-items: center; flex: none; }
.handle::after { content: ""; width: 56px; height: 4px; border-radius: 4px; background: var(--line); }
.tabs { display: flex; align-items: center; gap: 4px; padding: 0 16px; border-bottom: 1px solid var(--line); flex: none; }
.tab { padding: 9px 12px; color: var(--ink-2); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab.on { color: var(--ink); font-weight: 650; border-color: var(--accent); }
.tab:hover { color: var(--ink); }
.tabs .spacer { flex: 1; }
.body { overflow: auto; flex: 1; padding: 4px 16px 16px; }
.empty { color: var(--ink-3); padding: 24px 0; text-align: center; }

table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; font-weight: 650; color: var(--ink-2); padding: 10px 8px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.num { color: var(--ink-3); width: 1%; }
tr.warn td { background: var(--warn-row); }
tr.child td { background: transparent; padding-left: 28px; }
.sql { word-break: break-word; }
.sql.clip { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; }
/* An open query: laid out over lines, as it would be written by hand. */
.sql.formatted { white-space: pre-wrap; line-height: 1.55; cursor: pointer; }
.sql .kw { color: var(--accent); }
.sql .str { color: var(--ok); }
.sql .param { color: var(--warn); }
.sql .cm { color: var(--ink-3); }
.sub { color: var(--ink-2); font-size: 12px; margin-top: 3px; }
.badge { display: inline-block; font-size: 11.5px; font-weight: 650; padding: 1px 8px; border-radius: 999px; margin-left: 8px; vertical-align: 1px; }
.badge.n1, .badge.duplicate { background: var(--warn-soft); color: var(--warn); }
.badge.slow, .badge.error { background: var(--bad-soft); color: var(--bad); }
.dur { width: 160px; white-space: nowrap; }
.meter { height: 5px; border-radius: 3px; background: var(--bar); margin-top: 6px; min-width: 4px; }
.meter.slow { background: var(--bad-mark); }
.meter.n1 { background: var(--warn-mark); }
.origin { width: 1%; white-space: nowrap; }
.origin .sub a { color: var(--ink-3); }
table.requests tr { cursor: pointer; }
table.requests tr:hover td, table.requests tr.on td { background: var(--chrome); }
table.requests tr.main td { font-weight: 600; }
/* The page's calls hang from a faint line: a branch and a dot each, the line ending at the last one. */
table.requests tr.child td { border-bottom: 0; padding-left: 8px; }
table.requests tr.child td:first-child { position: relative; padding-left: 36px; }
.branch { position: absolute; left: 16px; top: 0; bottom: 0; width: 16px; }
.branch::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1px solid var(--line); }
.branch.last::before { bottom: calc(100% - 19px); }
.branch::after { content: ""; position: absolute; left: 0; top: 19px; width: 11px; border-top: 1px solid var(--line); }
.branch i { position: absolute; left: 10px; top: 16px; width: 7px; height: 7px; border-radius: 50%; background: var(--bg); border: 1px solid var(--ink-3); }
tr.child.on .branch i { background: var(--accent); border-color: var(--accent); }
.actions { margin-top: 6px; display: flex; gap: 12px; }
.actions button { color: var(--accent); font-size: 12px; }
.actions button.on { font-weight: 650; }

/* What the SQL alone shows, under a closed row, and the way into its plan. */
.clue { display: flex; align-items: baseline; gap: 6px; margin-top: 5px; font-size: 12px; color: var(--warn); }
.clue::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--warn-mark); transform: translateY(-1px); }
.clue.info { color: var(--ink-2); }
.clue.info::before { background: var(--ink-3); }
.clue.problem { color: var(--bad); }
.clue.problem::before { background: var(--bad-mark); }
.clue .more { color: var(--ink-3); }
.meta { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.explain-link { color: var(--accent); font-weight: 600; font-size: 12.5px; white-space: nowrap; margin-top: 3px; }
.explain-link:hover, .qtabs .link:hover, .tools .link:hover { text-decoration: underline; }
tr.open > td { border-bottom: 0; }

/* A query's tools: a row of their own, the table's whole width. Flat: lines and text, no boxes. */
tr.tools > td { padding: 2px 8px 20px; border-bottom: 1px solid var(--line); }
.qtabs { display: flex; align-items: baseline; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
.qtab { padding: 8px 0 9px; margin-right: 22px; color: var(--ink-2); border-bottom: 2px solid transparent; margin-bottom: -1px; font-weight: 600; }
.qtab:hover { color: var(--ink); }
.qtab.on { color: var(--ink); border-color: var(--accent); }
.qtab small { font-weight: 400; color: var(--ink-3); margin-left: 6px; font-size: 12px; }
.qtabs .spacer { flex: 1; }
.qtabs .link { color: var(--accent); font-size: 12.5px; margin-left: 18px; }
.qtabs .close { color: var(--ink-2); font-size: 12.5px; margin-left: 18px; }
.tools .link { color: var(--accent); }
.tools .link:disabled { color: var(--ink-3); cursor: default; text-decoration: none; }
.said { display: flex; justify-content: space-between; gap: 12px; margin: 14px 0 6px; color: var(--ink-2); font-size: 12px; }
.said b { color: var(--ink); font-weight: 650; }
.tools .h { font-size: 11.5px; font-weight: 650; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; margin: 16px 0 2px; }
.tools .h small { text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 12px; color: var(--ink-2); margin-left: 8px; }
.fix-code { margin: 6px 0 0; padding: 10px 14px; background: var(--chrome); border-radius: 6px; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre; overflow-x: auto; color: var(--ink); }
.fix-code .added { color: var(--ok); }
.fix-code .str { color: var(--ok); }
.fix-code .cm { color: var(--ink-3); }
.after { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-top: 6px; font-size: 12px; color: var(--ink-2); }
.links { display: flex; gap: 14px; }
td.rows { white-space: nowrap; font-variant-numeric: tabular-nums; }
.tools .badge { margin-left: 0; }
.badge.problem { background: var(--bad-soft); color: var(--bad); }
.badge.warning { background: var(--warn-soft); color: var(--warn); }
.badge.info, .badge.plain { background: var(--chrome); color: var(--ink-2); }
.badge.index { background: var(--ok-soft); color: var(--ok); }
.step { display: grid; grid-template-columns: auto auto 1fr auto; gap: 10px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--line); }
.step:last-child { border-bottom: 0; }
.step.flagged .what b { text-decoration: underline wavy var(--warn-mark); text-underline-offset: 3px; }
.step .tree { color: var(--ink-3); font-size: 12px; }
.step .detail { color: var(--ink-2); margin-left: 4px; }
.step .rows { color: var(--ink-3); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.find { display: grid; grid-template-columns: 76px 1fr auto; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.find:last-child { border-bottom: 0; }
.find .what { display: grid; gap: 5px; }
.find .fix { color: var(--ink-2); font-size: 12.5px; }
.find .line { display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: baseline; font-size: 12.5px; }
.find .line .mono { color: var(--ink); white-space: pre-wrap; word-break: break-word; }
.find .docs { color: var(--accent); font-size: 12px; white-space: nowrap; }
.tried { color: var(--ok); font-size: 12.5px; }
.tried.unused, .tried.failed { color: var(--warn); }
.tried .sub { color: inherit; opacity: .85; margin: 0; }
.fold { margin-top: 12px; color: var(--ink-2); font-size: 12.5px; }
.fold b { color: var(--ink); font-weight: 650; }
.raw-plan { margin: 6px 0 8px; padding: 10px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 11.5px; line-height: 1.5; white-space: pre; overflow-x: auto; max-height: 360px; }

.timeline { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; column-gap: 12px; row-gap: 8px; padding-top: 12px; }
.axis { position: relative; height: 18px; color: var(--ink-3); font-size: 11.5px; }
.axis span { position: absolute; transform: translateX(-50%); }
.axis span:first-child { transform: none; }
.axis span:last-child { transform: translateX(-100%); }
.track { position: relative; height: 16px; background-image: linear-gradient(to right, var(--line) 1px, transparent 1px); background-size: 25% 100%; }
.track i { position: absolute; top: 3px; height: 10px; border-radius: 2px; background: var(--bar); min-width: 3px; }
.track i.slow { background: var(--bad-mark); }
.track i.n1 { background: var(--warn-mark); }
.track i.raw { background: var(--ink-3); }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { color: var(--ink-3); font-size: 12px; margin-top: 12px; }

dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 16px 0; }
dt { color: var(--ink-2); }
dd { margin: 0; }

.recent {
  position: fixed; right: 12px; bottom: ${STRIP_HEIGHT + 6}px; z-index: 2147483647; width: 380px; max-height: 50vh; overflow: auto;
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); padding: 6px;
}
.recent > button { display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 6px; }
.recent > button:hover, .recent > button.on { background: var(--chrome); }
.recent-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px 6px; color: var(--ink-2); font-size: 12px; }
.clear { color: var(--ink-2); padding: 3px 9px; border-radius: 6px; font-size: 12px; }
.clear:hover { color: var(--bad); background: var(--bad-soft); }
.recent .sub { margin-top: 1px; }

.pill {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483600; display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 999px; background: var(--chrome); border: 1px solid var(--line); box-shadow: var(--shadow);
  font-size: 12px; color: var(--ink-2);
}
`;

export const pageStyles = `${styles}
:host { display: block; min-height: 100vh; background: var(--bg); }
.app { display: grid; grid-template-columns: 340px minmax(0, 1fr); min-height: 100vh; }
.side {
  position: sticky; top: 0; height: 100vh; overflow: auto; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 14px; background: var(--chrome); border-right: 1px solid var(--line);
}
.brand-row { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
.brand-row svg { width: 18px; height: 18px; }
.switch { display: flex; gap: 4px; }
.switch a { padding: 5px 12px; border-radius: 6px; color: var(--ink-2); }
.switch a:hover { text-decoration: none; color: var(--ink); }
.switch a.on { background: var(--bg); color: var(--ink); font-weight: 650; box-shadow: inset 0 0 0 1px var(--line); }
.switch .clear { margin-left: auto; }
.filter { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }
.list { display: flex; flex-direction: column; gap: 6px; }
.item { display: block; color: var(--ink); }
.item:hover { text-decoration: none; }
.group > .item { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
.group > .item:hover { border-color: var(--ink-3); }
.group > .item.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
/* Same drawing as the bar: a faint line drops from the page's box, with a branch and a dot to each call. */
.calls-tree { list-style: none; margin: 0 0 0 16px; padding: 0; }
.calls-tree li { position: relative; }
.calls-tree li::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; border-left: 1px solid var(--line); }
.calls-tree li:last-child::before { bottom: calc(100% - 17px); }
.calls-tree li::after { content: ""; position: absolute; left: 0; top: 17px; width: 11px; border-top: 1px solid var(--line); }
.item.child { padding: 7px 0 7px 26px; }
.item.child .node { position: absolute; left: 10px; top: 14px; width: 7px; height: 7px; border-radius: 50%; background: var(--chrome); border: 1px solid var(--ink-3); }
.item.child:hover .mono { color: var(--accent); }
.item.child.on .node { background: var(--accent); border-color: var(--accent); }
.item.child.on .mono { color: var(--accent); }
.main { padding: 24px 32px 48px; min-width: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
h1 { font-size: 22px; line-height: 1.25; margin: 0 0 4px; font-weight: 750; overflow-wrap: anywhere; }
h2 { font-size: 14px; margin: 28px 0 6px; }
.button { border: 1px solid var(--line); border-radius: 8px; padding: 7px 14px; color: var(--ink); white-space: nowrap; }
.button:hover { text-decoration: none; background: var(--chrome); }
.cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0 8px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; color: var(--ink-2); }
.card b { display: block; font-size: 22px; color: var(--ink); font-variant-numeric: tabular-nums; }
.card.warn { border-color: var(--warn-mark); }
.calls { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
.calls a { border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--ink); }
.page .tabs { padding: 0; margin-top: 16px; }
.content { padding-top: 4px; }
/* The session's analysis, on top of Stats: flat, like a query's tools. */
.session-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.analyze { color: var(--accent); font-weight: 600; font-size: 12.5px; white-space: nowrap; }
.analyze:hover { text-decoration: underline; }
.analyze:disabled { color: var(--ink-3); cursor: default; text-decoration: none; }
.session .lead { color: var(--ink-2); font-size: 12.5px; max-width: 90ch; }
.session .lead b { color: var(--ink); font-weight: 650; }
.session h3 { font-size: 13px; margin: 22px 0 4px; }
.session .h { font-size: 11.5px; font-weight: 650; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; margin: 18px 0 2px; }
.session .badge { margin-left: 0; }
.session td.n { width: 1%; white-space: nowrap; font-variant-numeric: tabular-nums; }
.session .link { color: var(--accent); }
.session .link:hover { text-decoration: underline; }
.session .on-table { color: var(--ink-2); font-size: 12px; margin-left: 8px; }
.session .acts { display: flex; flex-wrap: wrap; gap: 4px 16px; margin-top: 4px; font-size: 12px; }
.session .routes { color: var(--ink-2); }
.session .line { display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: baseline; margin-top: 6px; font-size: 12.5px; }
.session .line .mono { white-space: pre-wrap; word-break: break-word; }
.shape { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 14px; align-items: baseline; padding: 7px 0; margin-top: 6px; border-top: 1px solid var(--line); font-size: 12px; }
.shape .sql { cursor: auto; color: var(--ink-2); }
.shape .sub { margin: 0; white-space: nowrap; }
@media (max-width: 800px) {
  .app { grid-template-columns: 1fr; }
  .side { position: static; height: auto; }
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .main { padding: 20px 16px 40px; }
}
`;
