import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** PostgreSQL's own rules. */
// prettier-ignore
export const POSTGRES: Rule[] = [
  ["never-analyzed","read","postgres","unanalyzed & known","info","{table} has no statistics yet, so the plan guesses how many rows match.","analyze","https://www.postgresql.org/docs/current/planner-stats.html"],
  ["leading-wildcard","condition","postgres","leadingWildcard & !insensitive","warning","LIKE with % first on {column}: a B-tree index cannot find the rows, so every row is read.","trigram","https://www.postgresql.org/docs/current/pgtrgm.html"],
  ["insensitive-match","condition","postgres","insensitive","warning","ILIKE on {column}, as Prisma's mode: \"insensitive\" sends it: a B-tree index cannot find the rows, so every row is read.","trigram","https://www.postgresql.org/docs/current/pgtrgm.html"],
  ["foreign-key-without-index","foreign-key","postgres","unindexed","warning","{table}.{columns} references {references} with no index: PostgreSQL does not create one, so a join on it, or a delete in {references}, reads all of {table}.","index","https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK"],
  ["group-on-disk","group","postgres","onDisk","warning","The grouping ran out of memory and wrote to disk.","sort-memory"],
];
