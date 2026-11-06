import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** SQLite's own rules, from its documentation. */
// prettier-ignore
export const SQLITE: Rule[] = [
  ["automatic-index", "read", "sqlite", "automatic & known & !small", "problem", "SQLite builds a temporary index on {table} for {columns} every time this runs, then throws it away: a lasting index saves that work.", "index", "https://www.sqlite.org/optoverview.html#autoindex"],
  ["automatic-index-small", "read", "sqlite", "automatic & known & small", "info", "SQLite builds a temporary index on {table} for {columns} on every run: cheap at {rows} rows, but rebuilt each time and slower as the table grows.", "index", "https://www.sqlite.org/optoverview.html#autoindex"],
  ["automatic-index-on-subquery", "read", "sqlite", "automatic & !known", "info", "SQLite builds a temporary index on {table}, a subquery or view, every time this runs: a subquery cannot keep an index, so join or filter the table it reads instead.", undefined, "https://www.sqlite.org/changes.html#version_3_24_0"],
  ["index-unusable", "read", "sqlite", "full & served & unanalyzed & !small", "warning", "Reads every row of {table} although an index starts with {columns}: SQLite uses an index whenever the condition lets it, so the condition is what stops it. LIKE needs an index with COLLATE NOCASE, and a different COLLATE or column type also stops it.", undefined, "https://www.sqlite.org/optoverview.html#multi_index"],
  ["index-unusable-small", "read", "sqlite", "full & served & unanalyzed & small", "info", "Reads all {rows} rows of {table} although an index starts with {columns}: the condition stops SQLite from using it, so it will keep reading every row as the table grows.", undefined, "https://www.sqlite.org/optoverview.html#multi_index"],
  ["index-not-chosen", "read", "sqlite", "full & served & !unanalyzed & !small", "warning", "Reads every row of {table} instead of its index on {columns}: the statistics in sqlite_stat1 say the index helps little. Statistics gathered on a small development database say that of most indexes.", "analyze", "https://www.sqlite.org/lang_analyze.html#statanal"],
  ["index-not-chosen-small", "read", "sqlite", "full & served & !unanalyzed & small", "info", "Reads all {rows} rows of {table} instead of its index on {columns}: sqlite_stat1 says the table is small, and reading it all is cheaper at that size.", undefined, "https://www.sqlite.org/optoverview.html#multi_index"],
  ["never-analyzed", "read", "sqlite", "unanalyzed & known & !small", "info", "{table} has no statistics (sqlite_stat1 has no row for it), so SQLite assumes every table is large when it picks an index.", "optimize", "https://www.sqlite.org/lang_analyze.html"],
  ["foreign-key-without-index", "foreign-key", "sqlite", "unindexed", "warning", "{table}.{columns} references {references} with no index: SQLite does not create one, so loading {table} through the relation reads all of it, and so does each delete in {references} while foreign keys are on.", "index", "https://www.sqlite.org/foreignkeys.html#fk_indexes"],
  ["leading-wildcard", "condition", "sqlite", "leadingWildcard", "warning", "LIKE with a wildcard first on {column}: no index can find the rows, so SQLite reads every row.", "full-text", "https://www.sqlite.org/optoverview.html#like_opt"],
  ["temporary-sort", "sort", "sqlite", "temporary & sortable & !limited", "info", "Sorts the rows in a temporary b-tree: an index on {columns} gives them already in order.", "index", "https://www.sqlite.org/eqp.html#temporary_sorting_b_trees"],
  ["temporary-group", "group", "sqlite", "temporary", "info", "Groups or removes duplicates in a temporary b-tree, built on every run.", undefined, "https://www.sqlite.org/eqp.html#temporary_sorting_b_trees"],
  ["or-across-columns", "condition", "sqlite", "mixedOr & !join", "info", "OR between {column} and other columns: SQLite searches each side with its own index only when every side has one.", undefined, "https://www.sqlite.org/optoverview.html#or_opt"],
  ["not-in-subquery", "condition", "sqlite", "notInSubquery", "warning", "NOT IN with a subquery returns no rows when the subquery returns a NULL: NOT EXISTS has no such trap.", "not-exists", "https://www.sqlite.org/lang_expr.html#in_op"],
];
