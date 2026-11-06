import { describe, expect, it } from "vitest";
import {
  readStatement,
  type ColumnReference,
  type Condition,
  type Statement,
} from "../../src/analysis/statement.js";

const name = (column: ColumnReference) => `${column.table?.name ?? "?"}.${column.column}`;
/** Each condition of every query as "table.column OPERATOR kind", with what wraps the column. */
const conditions = (statement: Statement) =>
  statement.queries
    .flatMap((query) => query.conditions)
    .map(
      (condition: Condition) =>
        `${name(condition.column)}${condition.wrapper ? ` [${condition.wrapper}]` : ""} ${condition.operator} ${condition.kind}${condition.alternative ? " (or)" : ""}${condition.clause === "where" ? "" : ` (${condition.clause})`}`,
    );

// Prisma 7's own SQL, as recorded from PostgreSQL and MySQL.
const PRISMA = {
  page: `SELECT "public"."Order"."id", "public"."Order"."userId" FROM "public"."Order" WHERE ("public"."Order"."userId" = $1 AND "public"."Order"."status" = $2 AND "public"."Order"."total" >= $3) ORDER BY "public"."Order"."total" DESC LIMIT $4 OFFSET $5`,
  orNot: `SELECT "public"."User"."id" FROM "public"."User" WHERE (("public"."User"."email" = $1 OR "public"."User"."password" IS NULL) AND (NOT "public"."User"."id" IN ($2,$3,$4))) OFFSET $5`,
  contains: `SELECT "public"."User"."id" FROM "public"."User" WHERE "public"."User"."email" ILIKE ('%' || $1 || '%') OFFSET $2`,
  startsWith: `SELECT "public"."User"."id" FROM "public"."User" WHERE "public"."User"."email"::text LIKE ($1 || '%') OFFSET $2`,
  some: `SELECT "public"."User"."id" FROM "public"."User" WHERE EXISTS(SELECT "t0"."userId" FROM "public"."Order" AS "t0" WHERE ("t0"."status" = $1 AND ("public"."User"."id") = ("t0"."userId") AND "t0"."userId" IS NOT NULL)) OFFSET $2`,
  include: `SELECT "public"."Order"."id" FROM "public"."Order" WHERE ("public"."Order"."total" > $1 AND "public"."Order"."userId" IN ($2)) ORDER BY "public"."Order"."id" ASC OFFSET $3`,
  count: `SELECT COUNT(*) AS "_count$_all" FROM (SELECT "public"."Order"."id" FROM "public"."Order" WHERE "public"."Order"."userId" = $1 OFFSET $2) AS "sub"`,
  relationCount: `SELECT "public"."User"."id", COALESCE("aggr_selection_0_Order"."_aggr_count_orders", 0) AS "_aggr_count_orders" FROM "public"."User" LEFT JOIN (SELECT "public"."Order"."userId", COUNT(*) AS "_aggr_count_orders" FROM "public"."Order" WHERE 1=1 GROUP BY "public"."Order"."userId") AS "aggr_selection_0_Order" ON ("public"."User"."id" = "aggr_selection_0_Order"."userId") WHERE 1=1 OFFSET $1`,
  groupBy: `SELECT SUM("public"."Order"."total") AS "_sum$total", "public"."Order"."status" FROM "public"."Order" WHERE 1=1 GROUP BY "public"."Order"."status" HAVING SUM("public"."Order"."total") > $1 OFFSET $2`,
  cursor: `SELECT "public"."Order"."id" FROM "public"."Order" WHERE "public"."Order"."id" >= (SELECT "public"."Order"."id" FROM "public"."Order" WHERE ("public"."Order"."id") = ($1)) ORDER BY "public"."Order"."id" ASC LIMIT $2 OFFSET $3`,
  update: `UPDATE "public"."Order" SET "status" = $1 WHERE "public"."Order"."userId" = $2`,
  insert: `INSERT INTO "public"."User" ("email") VALUES ($1) RETURNING "public"."User"."id"`,
  mysqlContains: "SELECT `User`.`id` FROM `User` WHERE `User`.`email` LIKE CONCAT('%', ?, '%')",
  sqlitePage:
    "SELECT `main`.`Order`.`id` FROM `main`.`Order` WHERE `main`.`Order`.`userId` = ? LIMIT ? OFFSET ?",
};

describe("Prisma's SQL", () => {
  it("reads each filter's column, operator and kind, and the sorting and paging", () => {
    const statement = readStatement(PRISMA.page, "postgres");
    expect(statement.tables).toEqual([{ schema: "public", name: "Order" }]);
    expect(conditions(statement)).toEqual([
      "Order.userId = equality",
      "Order.status = equality",
      "Order.total >= range",
    ]);
    expect(statement.query.orderBy).toEqual([
      { column: { table: { schema: "public", name: "Order" }, column: "total" }, descending: true },
    ]);
    expect(statement.query).toMatchObject({ limit: { position: 4 }, offset: { position: 5 } });
  });

  it("marks conditions joined by OR, and a NOT in front as a negation", () => {
    const statement = readStatement(PRISMA.orNot, "postgres");
    expect(conditions(statement)).toEqual([
      "User.email = equality (or)",
      "User.password IS NULL null (or)",
      "User.id NOT IN negation",
    ]);
    // A B-tree index finds the rows that are not NULL as a range.
    expect(conditions(readStatement(`SELECT 1 FROM t WHERE a IS NOT NULL`, "postgres"))).toEqual([
      "t.a IS NOT NULL range",
    ]);
    expect(statement.longestList).toBe(3);
  });

  it("keeps what contains and startsWith compare with, and the cast Prisma puts on the column", () => {
    const [contains] = readStatement(PRISMA.contains, "postgres").query.conditions;
    expect(contains).toMatchObject({ operator: "ILIKE", kind: "pattern" });
    expect(contains!.value).toEqual({
      kind: "expression",
      text: "'%' || $1 || '%'",
      positions: [1],
    });
    const [startsWith] = readStatement(PRISMA.startsWith, "postgres").query.conditions;
    expect(startsWith).toMatchObject({ operator: "LIKE", wrapper: "::text" });
    const [mysql] = readStatement(PRISMA.mysqlContains, "mysql").query.conditions;
    expect(mysql!.value).toMatchObject({ kind: "expression", positions: [1] });
  });

  it("reads a relation filter's subquery, with its correlation to the outer table", () => {
    const statement = readStatement(PRISMA.some, "postgres");
    expect(statement.tables.map((table) => table.name)).toEqual(["User", "Order"]);
    expect(statement.tableOf("t0")).toEqual({ schema: "public", name: "Order" });
    const correlation = statement.queries[1]!.conditions[1]!;
    expect(name(correlation.column)).toBe("User.id");
    expect(correlation.value).toEqual({
      kind: "column",
      column: { table: { schema: "public", name: "Order" }, column: "userId" },
    });
  });

  it("counts a list of one in IN, as Prisma loads a relation for one row", () => {
    const statement = readStatement(PRISMA.include, "postgres");
    expect(statement.query.conditions[1]!.value).toEqual({ kind: "list", size: 1, positions: [2] });
    expect(statement.longestList).toBe(1);
  });

  it("follows a count's subquery and a relation count's derived table", () => {
    const count = readStatement(PRISMA.count, "postgres");
    expect(conditions(count)).toEqual(["Order.userId = equality"]);
    expect(count.queries[1]!.offset).toEqual({ position: 2 });
    const relation = readStatement(PRISMA.relationCount, "postgres");
    // The join's other side is the derived table's column, which belongs to no real table.
    expect(relation.query.conditions[0]).toMatchObject({
      clause: "join",
      value: { kind: "column", column: { column: "userId" } },
    });
    expect(relation.query.conditions[0]!.value).not.toHaveProperty("column.table");
    expect(relation.queries[1]!.groupBy).toEqual([
      { table: { schema: "public", name: "Order" }, column: "userId" },
    ]);
  });

  it("reads HAVING on an aggregate, and a cursor's subquery", () => {
    expect(conditions(readStatement(PRISMA.groupBy, "postgres"))).toEqual([
      "Order.total [sum()] > range (having)",
    ]);
    const cursor = readStatement(PRISMA.cursor, "postgres");
    expect(cursor.query.conditions[0]).toMatchObject({
      operator: ">=",
      value: { kind: "subquery" },
    });
    expect(conditions(cursor)).toEqual(["Order.id >= range", "Order.id = equality"]);
  });

  it("reads the table an UPDATE or an INSERT writes", () => {
    const update = readStatement(PRISMA.update, "postgres");
    expect(update.query.kind).toBe("update");
    expect(conditions(update)).toEqual(["Order.userId = equality"]);
    const insert = readStatement(PRISMA.insert, "postgres");
    expect(insert.query).toMatchObject({ kind: "insert", tables: [{ table: { name: "User" } }] });
  });

  it("reads MySQL's and SQLite's backticks and ? parameters", () => {
    const statement = readStatement(PRISMA.sqlitePage, "sqlite");
    expect(statement.tables).toEqual([{ schema: "main", name: "Order" }]);
    expect(statement.query).toMatchObject({ limit: { position: 2 }, offset: { position: 3 } });
  });
});

describe("SQL written by hand", () => {
  it("resolves each alias to its table, joins and their conditions", () => {
    const statement = readStatement(
      `select u.id, p.title from users u left join posts as p on p.author_id = u.id and p.published where u.email = $1`,
      "postgres",
    );
    expect(statement.tables.map((table) => table.name)).toEqual(["users", "posts"]);
    expect(statement.tableOf("p")).toEqual({ name: "posts" });
    expect(conditions(statement)).toEqual([
      "posts.author_id = equality (join)",
      "users.email = equality",
    ]);
  });

  it("folds unquoted names to lowercase on PostgreSQL only, as PostgreSQL does", () => {
    const sql = `SELECT Id FROM Users WHERE Email = $1`;
    expect(readStatement(sql, "postgres").tables).toEqual([{ name: "users" }]);
    expect(readStatement(sql.replace("$1", "?"), "mysql").tables).toEqual([{ name: "Users" }]);
    expect(readStatement(`SELECT 1 FROM "Users"`, "postgres").tables).toEqual([{ name: "Users" }]);
  });

  it("names what wraps a filtered column: a function, a cast, a collation", () => {
    const statement = readStatement(
      "SELECT 1 FROM t WHERE lower(email) = ? AND DATE(created_at) = ? AND CAST(code AS CHAR) = ? AND name COLLATE utf8mb4_bin = ?",
      "mysql",
    );
    expect(conditions(statement)).toEqual([
      "t.email [lower()] = equality",
      "t.created_at [date()] = equality",
      "t.code [cast as char] = equality",
      "t.name [COLLATE utf8mb4_bin] = equality",
    ]);
  });

  it("reads = ANY, BETWEEN, NOT LIKE, IS DISTINCT FROM and a value on the left", () => {
    const statement = readStatement(
      `SELECT 1 FROM t WHERE id = ANY($1) AND at BETWEEN $2 AND $3 AND name NOT LIKE $4 AND a IS DISTINCT FROM $5 AND $6 < b`,
      "postgres",
    );
    expect(conditions(statement)).toEqual([
      "t.id = equality",
      "t.at BETWEEN range",
      "t.name NOT LIKE negation",
      "t.a IS DISTINCT FROM negation",
      "t.b > range",
    ]);
    expect(statement.query.conditions[0]!.value).toEqual({ kind: "list", positions: [1] });
  });

  it("leaves a ? alone as PostgreSQL's JSON operator when the parameters are $1", () => {
    const statement = readStatement(`SELECT 1 FROM t WHERE data ? 'key' AND id = $1`, "postgres");
    expect(statement.query.conditions.map((condition) => condition.value)).toContainEqual({
      kind: "param",
      positions: [1],
    });
  });

  it("reads CTEs, UNION, and MySQL's LIMIT offset, count", () => {
    const cte = readStatement(
      `WITH recent AS (SELECT id FROM orders WHERE created_at > $1) SELECT * FROM recent r JOIN users u ON u.id = r.id`,
      "postgres",
    );
    // The statement's own tables first, then its subqueries'.
    expect(cte.tables.map((table) => table.name)).toEqual(["users", "orders"]);
    expect(cte.query.everyColumn).toBe(true);
    const union = readStatement(
      `SELECT id FROM a WHERE x = 1 UNION ALL SELECT id FROM b WHERE y = 2`,
      "postgres",
    );
    expect(union.tables.map((table) => table.name)).toEqual(["a", "b"]);
    expect(conditions(union)).toEqual(["a.x = equality", "b.y = equality"]);
    expect(readStatement("SELECT id FROM t ORDER BY id LIMIT 20, 10", "mysql").query).toMatchObject(
      {
        limit: { value: 10 },
        offset: { value: 20 },
      },
    );
  });

  it("reads UPDATE … FROM, DELETE … USING, INSERT … SELECT and MySQL's UPDATE with a join", () => {
    const update = readStatement(
      `UPDATE orders o SET status = 'late' FROM users u WHERE u.id = o.user_id AND u.active`,
      "postgres",
    );
    expect(update.tables.map((table) => table.name)).toEqual(["orders", "users"]);
    expect(conditions(update)).toEqual(["users.id = equality"]);
    const remove = readStatement(
      `DELETE FROM orders USING users WHERE orders.user_id = users.id AND users.banned`,
      "postgres",
    );
    expect(remove.query.kind).toBe("delete");
    expect(remove.tables.map((table) => table.name)).toEqual(["orders", "users"]);
    const copy = readStatement(
      `INSERT INTO archive (id) SELECT id FROM orders WHERE created_at < $1`,
      "postgres",
    );
    expect(copy.tables.map((table) => table.name)).toEqual(["archive", "orders"]);
    expect(conditions(copy)).toEqual(["orders.created_at < range"]);
    const joined = readStatement(
      "UPDATE `orders` o JOIN `users` u ON u.id = o.user_id SET o.flag = 1 WHERE u.banned = ?",
      "mysql",
    );
    expect(conditions(joined)).toEqual(["users.id = equality (join)", "users.banned = equality"]);
  });

  it("skips comments, and MySQL's index hints after a table", () => {
    const statement = readStatement(
      "/* list */ SELECT id FROM `orders` USE INDEX (idx_user) WHERE user_id = ? -- by user",
      "mysql",
    );
    expect(statement.tables).toEqual([{ name: "orders" }]);
    expect(conditions(statement)).toEqual(["orders.user_id = equality"]);
  });

  it("reads what it can of SQL cut short or not about data, and never throws", () => {
    const odd = [
      "",
      "SELECT * FROM t WHERE a IN (",
      "SELECT * FROM (SELECT 1",
      'SELECT "unterminated FROM t',
      "WITH a AS (SELECT",
      "UPDATE t SET",
      "PRAGMA foreign_keys = ON",
      "SELECT * FROM t WHERE (a, b) IN ((1, 2), (3, 4))",
      "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 10) SELECT * FROM r",
    ];
    for (const sql of odd)
      for (const engine of ["postgres", "mysql", "sqlite"] as const)
        expect(() => readStatement(sql, engine)).not.toThrow();
    // A recursive CTE reads itself: its name is no table.
    expect(readStatement(odd.at(-1)!, "postgres").tables).toEqual([]);
  });
});
