import { TIMING_NAME } from "../core/constants.js";
import { installTracker } from "./tracker.js";

/**
 * The script that puts the bar on a page. It only adds the bar once the page has loaded, so React's
 * hydration never sees it, and tracks the page's calls from the start, as the app makes some
 * (fetchers on mount, prefetches) before the bar is there. Without a token, it reads the page's
 * from the Server-Timing header of the page's own response. Run as a module, it may start after
 * the page has loaded.
 */
export function toolbarScript(base: string, token?: string): string {
  const options = JSON.stringify({ base, token, timing: TIMING_NAME });
  return `(function(o){var n=performance.getEntriesByType("navigation")[0],e=n&&n.serverTiming&&n.serverTiming.find(function(x){return x.name===o.timing}),t=o.token||(e&&e.description)||undefined;(${String(installTracker)})(o.base,t);var add=function(){setTimeout(function(){import(o.base+"/ui.js").then(function(){var bar=document.createElement("query-profiler-toolbar");bar.dataset.base=o.base;if(t)bar.dataset.token=t;document.body.appendChild(bar)})},0)};if(document.readyState==="complete")add();else addEventListener("load",add)})(${options})`;
}
