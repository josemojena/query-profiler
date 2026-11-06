import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** MySQL's and MariaDB's rules: InnoDB indexes every foreign key by itself. */
// prettier-ignore
export const MYSQL: Rule[] = [
  ["join-buffer","read","mysql mariadb","joinBuffer & missing","info","Joins {table} by reading all of it into a join buffer: an index on {columns} would look up only the rows each joined row needs.","index"],
  ["leading-wildcard","condition","mysql mariadb","leadingWildcard","warning","LIKE with % first on {column}: a B-tree index cannot find the rows, so every row is read.","fulltext"],
  ["temporary-sort","sort","mysql mariadb","temporary & sortable & !limited","info","Sorts through a temporary table: an index on {columns} gives the rows in order.","index"],
  ["temporary-group","group","mysql mariadb","temporary","info","Groups through a temporary table, built for every run."],
];
