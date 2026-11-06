import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** SQLite's own rules. */
// prettier-ignore
export const SQLITE: Rule[] = [
  ["automatic-index","read","sqlite","automatic","problem","SQLite builds a temporary index on {table} every time this runs, because the index it needs is missing: {columns}.","index","https://www.sqlite.org/optoverview.html#automatic_indexes"],
  ["never-analyzed","read","sqlite","unanalyzed & known & !small","info","{table} has no statistics (ANALYZE was never run), so SQLite assumes every table is large.","analyze","https://www.sqlite.org/lang_analyze.html"],
  ["leading-wildcard","condition","sqlite","leadingWildcard","warning","LIKE with % first on {column}: an index cannot find the rows, so every row is read.","full-text"],
  ["foreign-key-without-index","foreign-key","sqlite","unindexed","warning","{table}.{columns} references {references} with no index: SQLite does not create one, so a join on it, or a delete in {references}, reads all of {table}.","index","https://www.sqlite.org/foreignkeys.html#fk_indexes"],
  ["temporary-sort","sort","sqlite","temporary & sortable & !limited","info","Sorts through a temporary b-tree: an index on {columns} gives the rows in order.","index"],
  ["temporary-group","group","sqlite","temporary","info","Groups through a temporary b-tree, built for every run."],
];
