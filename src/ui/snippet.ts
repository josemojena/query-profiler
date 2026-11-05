import { installTracker } from "./tracker.js";

/**
 * The script that puts the bar on a page. It only adds the bar once the page has loaded, so React's
 * hydration never sees it, and tracks the page's calls from the start, as the app makes some
 * (fetchers on mount, prefetches) before the bar is there.
 */
export function toolbarScript(base: string, token: string): string {
  const options = JSON.stringify({ base, token });
  return `(function(o){(${String(installTracker)})(o.base,o.token);addEventListener("load",function(){setTimeout(function(){import(o.base+"/ui.js").then(function(){var bar=document.createElement("query-profiler-toolbar");bar.dataset.base=o.base;bar.dataset.token=o.token;document.body.appendChild(bar)})},0)})})(${options})`;
}
