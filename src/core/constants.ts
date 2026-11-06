export const DEFAULT_BASE = "/_profiler";
export const TOKEN_HEADER = "X-Debug-Token";
/** Sent by the bar on the calls a page makes, so their profiles hang under the page's. */
export const PARENT_HEADER = "X-Debug-Parent";
/** The Server-Timing entry that tells the browser a page's token, readable before the page runs. */
export const TIMING_NAME = "query-profiler";
/** Required on the calls that ask the database: a page on another origin cannot send it unasked. */
export const ANALYSIS_HEADER = "X-Query-Profiler";
