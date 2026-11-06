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
    expect(steps[0]).toMatchObject({ access: "unique", lookup: "rowid=?" });
    expect(steps[2]).toMatchObject({ kind: "sort", temporary: true });
  });

  it("marks an index SQLite built just for this query, which has no name", () => {
    const automatic = reads(readSqlitePlan(rows("sqlite-automatic-index")))[1];
    expect(automatic).toMatchObject({ table: "a", access: "automatic-index", lookup: "total=?" });
    expect(automatic!.index).toBeUndefined();
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
