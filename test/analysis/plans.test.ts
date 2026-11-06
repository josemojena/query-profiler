import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allSteps, type PlanStep } from "../../src/analysis/plan.js";
import { readMariadbPlan } from "../../src/analysis/plans/mariadb.js";
import { readMysqlPlan, readMysqlTree } from "../../src/analysis/plans/mysql.js";
import { readPostgresPlan } from "../../src/analysis/plans/postgres.js";
import { readSqlitePlan, sqlitePlanText } from "../../src/analysis/plans/sqlite.js";

// Each engine's own answer, captured from the real database.
const captured = (name: string) => readFileSync(new URL(`plans/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(captured(`${name}.json`));
const rows = (name: string) => json(name) as unknown[][];

/** Each step's label, indented under its parent. */
const outline = (steps: PlanStep[], depth = 0): string[] =>
  steps.flatMap((step) => [
    `${"  ".repeat(depth)}${step.label}`,
    ...outline(step.children, depth + 1),
  ]);
const reads = (steps: PlanStep[]) => allSteps(steps).filter((step) => step.kind === "read");

describe("PostgreSQL's plan", () => {
  it("names each table read, its alias, how it is read and what it filters", () => {
    const steps = readPostgresPlan(json("postgres-join"));
    expect(outline(steps)).toEqual(["Nested Loop (Inner)", "  Seq Scan", "  Seq Scan"]);
    expect(reads(steps)).toMatchObject([
      { table: "u", relation: "User", access: "full", filter: "(email = 'a@example.test'::text)" },
      { table: "o", relation: "Order", access: "full" },
    ]);
  });

  it("gives measured rows and time over every loop, from PostgreSQL's averages per loop", () => {
    const materialize = allSteps(readPostgresPlan(json("postgres-loops"))).find(
      (step) => step.label === "Materialize",
    );
    expect(materialize!.measured).toMatchObject({ rows: 90, loops: 3 });
  });

  it("takes an index scan with no condition for a read of every entry, for their order", () => {
    const [scan] = readPostgresPlan([
      {
        Plan: {
          "Node Type": "Index Scan",
          "Relation Name": "Post",
          Alias: "Post",
          "Index Name": "Post_pkey",
        },
      },
    ]);
    expect(scan).toMatchObject({ access: "index-full", index: "Post_pkey" });
  });

  it("marks a sort that ran out of memory and went to disk", () => {
    const [sort] = readPostgresPlan(json("postgres-sort-on-disk"));
    expect(sort).toMatchObject({ kind: "sort", keys: ["g DESC"], onDisk: true });
    expect(sort!.measured!.rows).toBe(20000);
  });
});

describe("MySQL's plan", () => {
  it("keeps the index each read used and the ones MySQL considered", () => {
    expect(reads(readMysqlPlan(json("mysql-join")))).toMatchObject([
      {
        table: "u",
        access: "unique",
        index: "User_email_key",
        possibleIndexes: ["PRIMARY", "User_email_key"],
      },
      { table: "o", access: "index", index: "Order_userId_fkey", lookup: "userId" },
    ]);
  });

  it("shows a sort or a grouping only when MySQL sorts or uses a temporary table for it", () => {
    const steps = readMysqlPlan(json("mysql-sort-and-group"));
    expect(outline(steps)).toEqual(["Sort, using filesort", "  Group, using temporary", "    ALL"]);
    expect(steps[0]!.children[0]).toMatchObject({ kind: "group", temporary: true });
  });

  it("reads EXPLAIN ANALYZE's tree, with each filter on the read it checks", () => {
    const steps = readMysqlTree(captured("mysql-analyze.txt"));
    expect(steps[0]).toMatchObject({ kind: "limit", measured: { rows: 1, loops: 1 } });
    // The estimate per loop, from (cost=… rows=…), next to what ran.
    expect(allSteps(steps).find((step) => step.table === "u")!.rows).toBe(1);
    expect(allSteps(steps).find((step) => step.kind === "sort")!.keys).toEqual(["o.total DESC"]);
    expect(reads(steps)).toMatchObject([
      { table: "u", access: "index-full", index: "User_email_key" },
      {
        table: "o",
        access: "index",
        index: "Order_userId_fkey",
        filter: "(o.total > 1)",
        measured: { rows: 1, removedByFilter: 0 },
      },
    ]);
  });
});

describe("MariaDB's plan", () => {
  it("marks a table joined through a join buffer, read in full, with its join condition", () => {
    expect(reads(readMariadbPlan(json("mariadb-join-without-index")))[1]).toMatchObject({
      table: "o",
      access: "full",
      filter: "o.total = u.`id`",
      notes: ["Using join buffer (BNL)"],
    });
  });

  it("nests a filesort over its temporary table over the read", () => {
    const steps = readMariadbPlan(json("mariadb-sort-and-group"));
    expect(outline(steps)).toEqual(["filesort", "  temporary table", "    ALL"]);
    expect(steps[0]!.keys).toEqual(["count(0) desc"]);
  });

  it("reads ANALYZE's measured rows, time and rows thrown away", () => {
    const [read] = reads(readMariadbPlan(json("mariadb-analyze")));
    expect(read).toMatchObject({ table: "Order", access: "full", filter: "`Order`.total > 1" });
    expect(read!.measured).toMatchObject({ rows: 1, loops: 1, removedByFilter: 0 });
    expect(read!.measured!.ms).toBeGreaterThan(0);
  });
});

describe("SQLite's plan", () => {
  it("builds the tree from each row's parent, with temporary b-trees for sorting", () => {
    const steps = readSqlitePlan(rows("sqlite-subquery"));
    expect(outline(steps)).toEqual([
      "SEARCH User USING INTEGER PRIMARY KEY (rowid=?)",
      "LIST SUBQUERY 1",
      "  SCAN Order",
      "USE TEMP B-TREE FOR ORDER BY",
    ]);
    expect(steps[0]).toMatchObject({ access: "index", lookup: "rowid=?" });
    expect(steps[2]).toMatchObject({ kind: "sort", temporary: true });
  });

  it("marks an index SQLite built just for this query, which has no name", () => {
    const automatic = reads(readSqlitePlan(rows("sqlite-automatic-index")))[1];
    expect(automatic).toMatchObject({ table: "a", access: "automatic-index", lookup: "total=?" });
    expect(automatic!.index).toBeUndefined();
  });

  it("reads 3.39's outer join and 3.51's EXISTS marks, an aggregate's sort, and a partial sort", () => {
    // From SQLite 3.53.
    const steps = readSqlitePlan([
      [3, 0, 0, "SCAN a USING COVERING INDEX a_x"],
      [16, 0, 0, "SEARCH b USING AUTOMATIC COVERING INDEX (a_id=?) LEFT-JOIN"],
      [18, 0, 0, "SEARCH c EXISTS USING AUTOMATIC PARTIAL COVERING INDEX (a_id=?)"],
      [20, 0, 0, "USE TEMP B-TREE FOR group_concat(ORDER BY)"],
      [21, 0, 0, "USE TEMP B-TREE FOR LAST TERM OF ORDER BY"],
      [22, 0, 0, "SEARCH d USING INTEGER PRIMARY KEY (rowid=?)"],
      [23, 0, 0, "SEARCH e"],
    ]);
    expect(steps.map((step) => [step.kind, step.table, step.access, step.notes])).toEqual([
      ["read", "a", "index-full", undefined],
      ["read", "b", "automatic-index", ["LEFT-JOIN"]],
      ["read", "c", "automatic-index", ["EXISTS"]],
      ["group", undefined, undefined, undefined],
      ["sort", undefined, undefined, undefined],
      // An IN list on the rowid prints the same as one row.
      ["read", "d", "index", undefined],
      ["read", "e", undefined, undefined],
    ]);
  });

  it("draws the plan the way the sqlite3 shell prints it", () => {
    expect(sqlitePlanText(rows("sqlite-subquery"))).toBe(
      [
        "QUERY PLAN",
        "|--SEARCH User USING INTEGER PRIMARY KEY (rowid=?)",
        "|--LIST SUBQUERY 1",
        "|  `--SCAN Order",
        "`--USE TEMP B-TREE FOR ORDER BY",
      ].join("\n"),
    );
  });
});

describe("MySQL's measured hash join", () => {
  it("marks the table read into the hash, the join buffer", () => {
    const steps = readMysqlTree(
      [
        "-> Inner hash join (o.title = a.`name`)  (cost=2.05e+6 rows=2e+6) (actual time=1.2..9.8 rows=20 loops=1)",
        "    -> Table scan on o  (cost=1.01 rows=20000) (actual time=0.05..4.2 rows=20000 loops=1)",
        "    -> Hash",
        "        -> Table scan on a  (cost=101 rows=1000) (actual time=0.02..0.3 rows=1000 loops=1)",
      ].join("\n"),
    );
    const reads = allSteps(steps).filter((step) => step.kind === "read");
    expect(reads.map((read) => [read.table, read.notes])).toEqual([
      ["o", undefined],
      ["a", ["Using join buffer (hash join)"]],
    ]);
  });
});

describe("MySQL's JSON format version 2, the default from 9.5", () => {
  it("reads the tree of iterators: reads with their index and lookup, the hash join's table, sorts and limits", () => {
    expect(reads(readMysqlPlan(json("mysql-v2-join")))).toMatchObject([
      {
        table: "a",
        access: "index-only",
        index: "qp_a_email",
        lookup: "email='author5@example.test'",
        rows: 1,
      },
      { table: "p", access: "index-only", index: "qp_p_a", lookup: "a_id=a.id" },
    ]);
    const sorted = readMysqlPlan(json("mysql-v2-scan-sort"));
    expect(outline(sorted)).toEqual(["Limit: 10 row(s)", "  Sort", "    Table scan on qp_p"]);
    expect(sorted[0]!.children[0]).toMatchObject({ kind: "sort", keys: ["qp_p.views DESC"] });
    expect(reads(sorted)[0]).toMatchObject({
      access: "full",
      relation: "qp_p",
      filter: "((qp_p.title = 'Post 42') or (qp_p.views > 490))",
      rows: 4202,
    });
    const hashed = reads(readMysqlPlan(json("mysql-v2-hash")));
    expect(hashed.map((read) => [read.table, read.notes])).toEqual([
      ["p", undefined],
      ["a", ["Using join buffer (hash join)"]],
    ]);
  });
});
