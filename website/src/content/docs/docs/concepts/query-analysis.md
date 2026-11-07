---
title: Query analysis
description: Each query's plan from your database, what is wrong with it, and the index or change that fixes it.
---

Open a query in the **Queries** tab, of the bar or of `/_profiler`, and the profiler asks your
database how it runs that query. It reads the answer with rules written from each engine's manual,
and tells you what is wrong and how to fix it: the `@@index` line for `schema.prisma`, the SQL, or the
change to the query. The `@@index` line uses your schema's names: a model mapped with `@@map` or a
field mapped with `@map` shows as you wrote it, not as the database calls it.

There is no AI in it, and nothing leaves your machine. The plan comes from your database's own
planner, through the same connection your app uses, and the rules run in the profiler.

## Three levels

1. **Under every query, without asking the database.** The SQL and its values alone show some
   problems: a `LIKE` with `%` first, `ILIKE` (Prisma's `mode: "insensitive"`), a function on a
   filtered column, a deep `OFFSET`, a `NOT IN` with a `NULL`, a read with no limit that returned
   1,000 rows or more. The first one shows under the closed row. These are hints: they do not count
   as warnings.
2. **Explain plan.** Every row the database can be asked about has **Explain ›**. It opens the query
   on its plan, estimated: the query does not run. You see each step (a table read in full, an index
   used, a sort, a temporary table), with the notes MySQL, MariaDB and SQLite add to it under it
   (`Using index condition`, a rowid filter's index, how often a subquery cache answered), the
   tables' indexes, and the findings, most severe first, each with its fix.
3. **Try this index.** On PostgreSQL and SQLite, which can undo a `CREATE INDEX`, the profiler
   creates the suggested index inside a transaction, asks for the plan again, and rolls everything
   back. It tells you whether the database uses the index, and the plan's cost without it and with
   it. On a small development table PostgreSQL is told to avoid reading every row, so the trial shows
   whether the index can serve, not whether it is worth it yet. MySQL and MariaDB commit a
   `CREATE INDEX` at once, so there it cannot be tried.

**Measure it**, next to Explain plan, runs a read in a transaction that is rolled back, and shows the
rows and time each step really had: rows read only to be thrown away, estimates far from the real
count. It never runs a write, a locking read (`FOR UPDATE`, `FOR SHARE`), or anything on SQLite,
which does not measure plans. On PostgreSQL it stops after 10 seconds.

## What it finds

Some of the [rules](/docs/reference/rules), by what they look at:

- **How a table is read.** Every row of a big table read to find a few, for want of an index, with
  the index to add, its columns in the order an index can use them: equality first, then the sort,
  then one range. An index that has the column after another one. A join that reads a table again for
  every row it joins, and a correlated subquery that reads it again for every outer row. A table never
  analyzed, or whose statistics are out of date.
- **The query.** A `%` first, `ILIKE`, a function or cast on the column, a text column compared with
  a number, `OR` across columns, huge `IN` lists, a deep `OFFSET`, paging with no `ORDER BY` or
  ordered by columns several rows share, counting a whole table, `NOT IN` and its `NULL`.
- **The tables**, whatever the query: a foreign key with no index (PostgreSQL and SQLite never
  create one; Prisma's documentation says the database "usually" does), a redundant or duplicate
  index, an index left invalid.
- **Each engine's own**: PostgreSQL's JIT and planning time, hashes and sorts that went to disk,
  partial indexes against parameters; MySQL's and MariaDB's join buffers and writes that lock every
  row they read; MySQL's ranges that stop an index before an equality, and groupings through a
  temporary table; SQLite's automatic indexes, and the foreign key checks that read a whole child
  table on every delete.

Every rule links to the section of its engine's manual that backs it, and is tested against the real
engine.

## The whole session

One query at a time shows what is wrong with it; the session shows what to fix first. On the
[Stats](/docs/concepts/profiler-page) page, **Analyze the session ›** asks your database for the plan
of every distinct statement in the stored requests (the same SQL with other values counts once),
through its slowest run, and adds them up:

- **Indexes to add**, ranked by the time the statements they would serve took: the `@@index` line to
  copy, its SQL, how many statements it fixes, how often they ran, and on which routes. When one
  index starts with another's columns, only the wider one is listed: it serves both.
- **What the rules find** across the session, most severe first, then by time: every problem and the
  six warnings with the most time, the rest folded. **Open** goes to the slowest statement it was
  found in, in its request, on Explain plan.
- **Tables**: the statements and time on each, and how many read it in full; under them, what holds
  for a table whatever the query, once each.

Nothing runs: it asks for estimated plans only, and only when you press it.

## Each engine

| Engine     | Estimated plan                                           | Measured plan                             | Index trial |
| ---------- | -------------------------------------------------------- | ----------------------------------------- | ----------- |
| PostgreSQL | `EXPLAIN (FORMAT JSON)`                                  | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` | Yes         |
| MySQL      | `EXPLAIN FORMAT=JSON` (format version 1, and 2 from 9.5) | `EXPLAIN ANALYZE FORMAT=TREE`             | No          |
| MariaDB    | `EXPLAIN FORMAT=JSON`                                    | `ANALYZE FORMAT=JSON`                     | No          |
| SQLite     | `EXPLAIN QUERY PLAN`                                     | none                                      | Yes         |

Each engine's answer is read into the same steps, so the profiler shows them alike, and **Show the
database's plan** shows the engine's own.

## Good to know

- **Development data is small.** With a few rows, reading a whole table is cheaper than any index,
  and the database does it. The profiler says so instead of calling it a problem, and the index
  trial still shows whether an index would serve as the table grows. Seed your development database
  with realistic sizes to see the plans production will have.
- **Hidden values.** A parameter hidden as a secret is planned without its value on PostgreSQL 16 and
  later (`GENERIC_PLAN`), and with a stand-in elsewhere: the plan says which.
- **Only the SQL your app ran.** The profiler explains a recorded query by its id, and tries only the
  index it suggested itself. It never takes SQL from the browser.
- **Only from the page.** Explain plan, Measure it, Try this index and Analyze the session need the
  `X-Query-Profiler` header, which a page on another origin cannot send without a preflight the profiler never answers.
