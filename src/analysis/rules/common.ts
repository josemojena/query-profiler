import type { Rule } from "./engine.js";

// One rule per line: [id, subject, engines, when, severity, message, fix, docs]. See engine.ts.

/** Rules every engine shares. */
// prettier-ignore
export const COMMON: Rule[] = [
  ["full-scan-missing-index","read","*","full & missing & !small & !inner & !write","problem","Reads every row of {table} to find the ones it wants: no index has {columns}.","index"],
  ["full-scan-small-table","read","*","full & missing & small & !inner","info","Reads all {rows} rows of {table}: cheap at this size, but no index has {columns}, so it will read every row as the table grows.","index"],
  ["full-scan-index-skipped","read","*","full & served & !small & !measured","warning","Reads every row of {table} although an index leads with {columns}: the database expects most rows to match, or its statistics are out of date.","analyze"],
  ["full-scan-index-skipped-small","read","*","full & served & small","info","Reads all {rows} rows of {table} instead of its index on {columns}: with this few rows that is cheaper, and it will switch to the index as the table grows."],
  ["join-without-index","read","*","inner & (full | indexFull) & missing","problem","Reads {table} again for every row it is joined with: no index has {columns}.","index"],
  ["write-scan","read","*","write & full & missing & !small","problem","Reads every row of {table} to find the rows to change: no index has {columns}.","index"],
  ["full-index-scan","read","*","indexFull & !inner & filtered & !small","warning","Reads every entry of the index {index} on {table}: none starts with the columns it filters on, {columns}.","index"],
  ["many-loops","read","*","measured & manyLoops & !indexed","warning","Read {table} {loops} times, once for every row on the other side of the join, without an index.","index"],
  ["rows-thrown-away","read","*","measured & wasteful","warning","Read {removed} rows of {table} only to throw them away, keeping {actual}.","index"],
  ["misestimated-rows","read","*","measured & misestimated","warning","Expected {estimated} rows from {table} and found {actual}: a plan built on the wrong count can pick the wrong way to read and join.","analyze"],
  ["sort-without-index","sort","*","sortable & limited","warning","Sorts every matching row to return the first ones: an index on {columns} gives them in order and stops at the limit.","index"],
  ["sort-on-disk","sort","*","onDisk","problem","The sort ran out of memory and wrote to disk.","sort-memory"],
  ["function-on-column","condition","*","wrapped & !having","warning","{wrapper} on {column} hides the column from its index: compare the column itself, or index the expression.","expression-index"],
  ["or-across-columns","condition","*","mixedOr & !join","info","OR between {column} and other columns: an index on one column cannot find the rows of the other side."],
  ["long-in-list","condition","*","longList & !hugeList","info","IN with {size} values on {column}."],
  ["huge-in-list","condition","*","hugeList","warning","IN with {size} values on {column}: Prisma loads a relation this way for every parent row, which grows with the page.","join-strategy"],
  ["equals-null","condition","*","equalsNull","problem","{column} {operator} NULL is never true: NULL is compared with IS NULL or IS NOT NULL."],
  ["not-in-subquery","condition","*","notInSubquery","warning","NOT IN with a subquery returns no rows at all when the subquery returns a NULL, and plans worse than NOT EXISTS.","not-exists"],
  ["deep-offset","query","*","deepOffset","warning","Skips {offset} rows to return the next ones: every page reads all the rows before it.","keyset"],
  ["random-order","query","*","randomOrder","warning","ORDER BY random() reads and sorts every row to return a few."],
  ["write-every-row","query","*","unfilteredWrite","warning","Changes every row of {table}: an updateMany or deleteMany with an empty where."],
  ["redundant-index","index","*","redundant","info","The index {index} on {table} is the start of {other}, which serves the same queries: one index fewer to update on every write.","drop-index"],
  ["duplicate-index","index","*","duplicate","warning","The indexes {index} and {other} on {table} have the same columns: every write updates both.","drop-index"],
];
