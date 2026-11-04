import { ProfilerToolbar } from "./element.js";
import { ProfilerPage } from "./page-element.js";

export const TAG = "query-profiler-toolbar";
export const PAGE_TAG = "query-profiler-page";

if (!customElements.get(TAG)) customElements.define(TAG, ProfilerToolbar);
if (!customElements.get(PAGE_TAG)) customElements.define(PAGE_TAG, ProfilerPage);

export { ProfilerPage, ProfilerToolbar };
