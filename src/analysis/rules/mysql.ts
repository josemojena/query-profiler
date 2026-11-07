import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** MySQL's own rules, from its manual. */
// prettier-ignore
export const MYSQL: Rule[] = [
  ["join-buffer", "read", "mysql", "joinBuffer & missing & !small", "warning", "Reads all of {table} to join it, matching its rows against the earlier tables' rows held in a join buffer: an index on {columns} would look up only the rows each joined row needs.", "index", "https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html"],
  ["join-buffer-small", "read", "mysql", "joinBuffer & missing & small", "info", "Joins {table} through a join buffer, reading all {rows} of its rows: cheap at this size, but with no index on {columns} it reads the whole table on every run as it grows.", "index", "https://dev.mysql.com/doc/refman/8.4/en/hash-joins.html"],
  ["index-considered-not-used", "read", "mysql", "full & considered & !served & !missing & !small & !inner", "warning", "MySQL considered the indexes {possible} for {table} but read every row: it expects most rows to match, or its statistics are out of date.", "analyze", "https://dev.mysql.com/doc/refman/8.4/en/table-scan-avoidance.html"],
  ["write-index-scan", "read", "mysql", "write & indexFull & !small", "warning", "Reads every entry of the index {index} on {table} to find the rows to change, and InnoDB locks each entry it reads until the transaction ends.", "index", "https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html"],
  ["write-locks-every-row", "read", "mysql", "write & full & missing & small", "info", "Reads all {rows} rows of {table} to find the rows to change, and InnoDB locks every one until the transaction ends, which blocks inserts by others meanwhile: an index on {columns} locks only the rows it needs.", "index", "https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html"],
  ["invisible-index-would-serve", "read", "mysql", "hiddenIndex & (full | indexFull)", "warning", "The invisible index {hidden} on {table} leads with a column this read needs: make it visible instead of adding another index.", undefined, "https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html"],
  ["leading-wildcard", "condition", "mysql", "leadingWildcard", "warning", "LIKE with % first on {column}: a B-tree index cannot seek to the rows, so MySQL reads every row unless another condition narrows them first.", "fulltext", "https://dev.mysql.com/doc/refman/8.4/en/index-btree-hash.html"],
  ["number-on-string", "condition", "mysql", "numberOnString", "warning", "{column} is text compared with a number: MySQL converts every row's text to a number to compare them, so its index cannot be used. Pass the value as a string.", undefined, "https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html"],
  ["temporary-sort", "sort", "mysql", "temporary & sortable & !limited", "info", "Sorts through a temporary table: an index on {columns} gives the rows in order.", "index", "https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html"],
  ["temporary-group", "group", "mysql", "temporary", "info", "Groups through a temporary table, built for every run: an index that starts with the GROUP BY columns lets MySQL read the rows already grouped.", undefined, "https://dev.mysql.com/doc/refman/8.4/en/group-by-optimization.html"],
  ["impossible-condition", "query", "mysql", "impossible", "info", "{reason}: MySQL found from the constants alone that no row can match, so the query returns nothing.", undefined, "https://dev.mysql.com/doc/refman/8.4/en/explain-output.html#explain-extra-information"],
  ["invisible-index", "index", "mysql", "invisible", "info", "The index {index} on {table} is invisible: MySQL keeps it up to date on every write but never uses it. Make it visible, or drop it.", "drop-index", "https://dev.mysql.com/doc/refman/8.4/en/invisible-indexes.html"],
];
