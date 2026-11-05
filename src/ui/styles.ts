export const STRIP_HEIGHT = 34;

export const styles = `
:host {
  --bg: #ffffff;
  --chrome: #f4f5f7;
  --ink: #16181d;
  --ink-2: #5c6170;
  --ink-3: #8a8f9c;
  --line: #e2e4e9;
  --line-strong: #c4c8d0;
  --accent: #2563eb;
  --ok: #166534;
  --ok-soft: #dcfce7;
  --bad: #b42318;
  --bad-soft: #fde4e1;
  --warn: #92400e;
  --warn-soft: #fdf0d2;
  --warn-row: #fffaeb;
  --bar: #3b82f6;
  --shadow: 0 -8px 24px rgb(16 24 40 / 0.08);
  all: initial;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #15171c;
    --chrome: #1d2027;
    --ink: #e8eaef;
    --ink-2: #a3a8b5;
    --ink-3: #7c8190;
    --line: #2c3039;
    --line-strong: #464b57;
    --accent: #6c9cff;
    --ok: #86efac;
    --ok-soft: #14361f;
    --bad: #fca5a5;
    --bad-soft: #3b1717;
    --warn: #fcd34d;
    --warn-soft: #3a2c0b;
    --warn-row: #2a2312;
    --bar: #6c9cff;
    --shadow: 0 -8px 24px rgb(0 0 0 / 0.4);
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
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; margin-right: 6px; vertical-align: 1px; }
.dot.bad { background: #ef4444; }
.chip { color: var(--ink-2); padding: 3px 8px; border-radius: 6px; }
.chip:hover, .chip.on { background: var(--line); color: var(--ink); }
.brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 650; color: var(--ink-2); }
.brand svg { width: 15px; height: 15px; }

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
.sub { color: var(--ink-2); font-size: 12px; margin-top: 3px; }
.badge { display: inline-block; font-size: 11.5px; font-weight: 650; padding: 1px 8px; border-radius: 999px; margin-left: 8px; vertical-align: 1px; }
.badge.n1, .badge.duplicate { background: var(--warn-soft); color: var(--warn); }
.badge.slow, .badge.error { background: var(--bad-soft); color: var(--bad); }
.dur { width: 160px; white-space: nowrap; }
.meter { height: 5px; border-radius: 3px; background: var(--bar); margin-top: 6px; min-width: 4px; }
.meter.slow { background: #dc2626; }
.meter.n1 { background: #f59e0b; }
.origin { width: 1%; white-space: nowrap; }
.origin .sub a { color: var(--ink-3); }
table.requests tr { cursor: pointer; }
table.requests tr:hover td, table.requests tr.on td { background: var(--chrome); }
table.requests tr.main td { font-weight: 600; }
table.requests tr.child td { font-weight: 400; padding-left: 8px; }
td.branch { position: relative; width: 1%; white-space: nowrap; }
tr.parent td.branch::after { content: ""; position: absolute; left: 21px; top: 30px; bottom: -1px; border-left: 1.5px solid var(--line-strong); }
table.requests tr.child td.branch { padding-left: 44px; }
tr.child td.branch::before { content: ""; position: absolute; left: 21px; top: -1px; width: 16px; height: 21px; border-left: 1.5px solid var(--line-strong); border-bottom: 1.5px solid var(--line-strong); border-bottom-left-radius: 6px; }
tr.call td.branch::after { content: ""; position: absolute; left: 21px; top: -1px; bottom: -1px; border-left: 1.5px solid var(--line-strong); }
.code-ok { color: var(--ok); }
.code-warn { color: var(--warn); }
.code-bad { color: var(--bad); }
.code-muted { color: var(--ink-3); }
.actions { margin-top: 6px; display: flex; gap: 12px; }
.actions button { color: var(--accent); font-size: 12px; }

.timeline { display: grid; grid-template-columns: minmax(140px, 220px) 1fr; column-gap: 12px; row-gap: 8px; padding-top: 12px; }
.axis { position: relative; height: 18px; color: var(--ink-3); font-size: 11.5px; }
.axis span { position: absolute; transform: translateX(-50%); }
.axis span:first-child { transform: none; }
.axis span:last-child { transform: translateX(-100%); }
.track { position: relative; height: 16px; background-image: linear-gradient(to right, var(--line) 1px, transparent 1px); background-size: 25% 100%; }
.track i { position: absolute; top: 3px; height: 10px; border-radius: 2px; background: var(--bar); min-width: 3px; }
.track i.slow { background: #dc2626; }
.track i.n1 { background: #f59e0b; }
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
.recent button { display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 6px; }
.recent button:hover, .recent button.on { background: var(--chrome); }
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
.filter { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); }
.list { display: flex; flex-direction: column; gap: 6px; }
.item { display: block; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); }
.item:hover { text-decoration: none; border-color: var(--ink-3); }
.item.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.group { display: flex; flex-direction: column; }
.branches { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0 38px; }
.item.child { position: relative; padding: 5px 10px; border-color: transparent; background: transparent; border-radius: 6px; }
.item.child:hover { background: var(--line); }
.item.child.on { background: var(--bg); }
.item.child::before { content: ""; position: absolute; left: -18px; top: -4px; width: 14px; height: 19px; border-left: 1.5px solid var(--line-strong); border-bottom: 1.5px solid var(--line-strong); border-bottom-left-radius: 6px; }
.item.child:not(:last-child)::after { content: ""; position: absolute; left: -18px; top: -4px; bottom: -2px; border-left: 1.5px solid var(--line-strong); }
.main { padding: 24px 32px 48px; min-width: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
h1 { font-size: 22px; line-height: 1.25; margin: 0 0 4px; font-weight: 750; overflow-wrap: anywhere; }
h2 { font-size: 14px; margin: 28px 0 6px; }
.button { border: 1px solid var(--line); border-radius: 8px; padding: 7px 14px; color: var(--ink); white-space: nowrap; }
.button:hover { text-decoration: none; background: var(--chrome); }
.cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0 8px; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; color: var(--ink-2); }
.card b { display: block; font-size: 22px; color: var(--ink); font-variant-numeric: tabular-nums; }
.card.warn { border-color: #f59e0b; }
.calls { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 4px; }
.calls a { border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--ink); }
.page .tabs { padding: 0; margin-top: 16px; }
.content { padding-top: 4px; }
@media (max-width: 800px) {
  .app { grid-template-columns: 1fr; }
  .side { position: static; height: auto; }
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .main { padding: 20px 16px 40px; }
}
`;
