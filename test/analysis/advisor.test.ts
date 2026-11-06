import { describe, expect, it } from "vitest";
import {
  adviseIndex,
  adviseSortIndex,
  patternText,
  wantedColumns,
  writeAdvice,
} from "../../src/analysis/advisor.js";
import type { Index } from "../../src/analysis/catalog.js";
import type { Engine } from "../../src/analysis/plan.js";
import { readStatement } from "../../src/analysis/statement.js";

const ORDER = { schema: "public", name: "Order" };

function advise(
  sql: string,
  params: unknown[],
  existing: Index[] = [],
  engine: Engine = "postgres",
  table = ORDER,
) {
  const statement = readStatement(sql, engine);
  const queries = statement.queries;
  return adviseIndex({
    engine,
    table,
    conditions: queries.flatMap((query) => query.conditions),
    orderBy: statement.query.orderBy,
    params,
    existing,
  });
}

const index = (columns: string[], extra: Partial<Index> = {}): Index => ({
  name: `i_${columns.join("_")}`,
  columns,
  unique: false,
  primary: false,
  expression: false,
  ...extra,
});

const PAGE = `SELECT "public"."Order"."id" FROM "public"."Order" WHERE ("public"."Order"."userId" = $1 AND "public"."Order"."status" = $2 AND "public"."Order"."total" >= $3) ORDER BY "public"."Order"."createdAt" DESC LIMIT $4 OFFSET $5`;
const SOME = `SELECT "public"."User"."id" FROM "public"."User" WHERE EXISTS(SELECT "t0"."userId" FROM "public"."Order" AS "t0" WHERE ("t0"."status" = $1 AND ("public"."User"."id") = ("t0"."userId") AND "t0"."userId" IS NOT NULL)) OFFSET $2`;

describe("the index a query wants", () => {
  it("lists equality columns, then the sort, then one range", () => {
    expect(advise(PAGE, [1, "paid", 5, "10", "0"])!.columns).toEqual([
      { name: "userId" },
      { name: "status" },
      { name: "createdAt", descending: true },
      { name: "total" },
    ]);
  });

  it("writes it the way Prisma names it, for schema.prisma and as each engine's SQL", () => {
    const advice = writeAdvice("postgres", ORDER, [
      { name: "userId" },
      { name: "createdAt", descending: true },
    ]);
    expect(advice).toMatchObject({
      name: "Order_userId_createdAt_idx",
      prisma: "@@index([userId, createdAt(sort: Desc)])",
      sql: 'CREATE INDEX "Order_userId_createdAt_idx" ON "public"."Order" ("userId", "createdAt" DESC);',
    });
    expect(writeAdvice("mysql", { name: "Order" }, [{ name: "userId" }]).sql).toBe(
      "CREATE INDEX `Order_userId_idx` ON `Order` (`userId`);",
    );
    expect(writeAdvice("sqlite", { schema: "main", name: "Order" }, [{ name: "userId" }]).sql).toBe(
      'CREATE INDEX "Order_userId_idx" ON "Order" ("userId");',
    );
  });

  it("asks for nothing when an index already leads with a column the query uses", () => {
    const params = [1, "paid", 5, "10", "0"];
    expect(advise(PAGE, params, [index(["userId"])])).toBeUndefined();
    expect(advise(PAGE, params, [index(["status", "id"])])).toBeUndefined();
    // An index on another column, an expression or a part of the rows does not serve it.
    expect(advise(PAGE, params, [index(["id"], { primary: true, unique: true })])).toBeDefined();
    expect(advise(PAGE, params, [index(["userId"], { where: "archived = false" })])).toBeDefined();
  });

  it("takes a relation filter's join column from the other side of the =", () => {
    expect(advise(SOME, ["paid", "0"], [], "postgres")!.columns).toEqual([
      { name: "status" },
      { name: "userId" },
    ]);
  });

  it("leaves out what a B-tree index cannot use: OR, a function on the column, a negation, a leading %", () => {
    const user = { schema: "public", name: "User" };
    const sql = (where: string) => `SELECT 1 FROM "public"."User" WHERE ${where}`;
    for (const where of [
      `("public"."User"."email" = $1 OR "public"."User"."name" = $2)`,
      `lower("public"."User"."email") = $1`,
      `"public"."User"."email" <> $1`,
      `"public"."User"."email" ILIKE ('%' || $1 || '%')`,
    ])
      expect(advise(sql(where), ["a", "b"], [], "postgres", user)).toBeUndefined();
  });

  it("uses a LIKE that starts with fixed text as a range, as Prisma's startsWith with ::text on the column", () => {
    const user = { schema: "public", name: "User" };
    const sql = `SELECT 1 FROM "public"."User" WHERE "public"."User"."email"::text LIKE ($1 || '%') OFFSET $2`;
    expect(advise(sql, ["ab", "0"], [], "postgres", user)!.columns).toEqual([{ name: "email" }]);
    const statement = readStatement(sql, "postgres");
    expect(
      wantedColumns({
        engine: "postgres",
        table: user,
        conditions: statement.query.conditions,
        orderBy: [],
        params: ["%ab", "0"],
        existing: [],
      }),
    ).toEqual([]);
  });
});

describe("the pattern a LIKE compares with", () => {
  it("reads it from the SQL, from Prisma's concatenations, or from the recorded value", () => {
    const pattern = (sql: string, params: unknown[], engine: Engine = "postgres") =>
      patternText(readStatement(sql, engine).query.conditions[0]!.value, params);
    expect(pattern(`SELECT 1 FROM t WHERE a LIKE 'ab%'`, [])).toBe("ab%");
    expect(pattern(`SELECT 1 FROM t WHERE a LIKE $1`, ["%ab"])).toBe("%ab");
    expect(pattern(`SELECT 1 FROM t WHERE a ILIKE ('%' || $1 || '%')`, ["ab"])).toBe("%");
    expect(pattern("SELECT 1 FROM t WHERE a LIKE CONCAT('%', ?, '%')", ["ab"], "mysql")).toBe("%");
    expect(pattern(`SELECT 1 FROM t WHERE a LIKE ($1 || '%')`, ["ab"])).toBe("ab");
  });
});

describe("the indexes that count", () => {
  const post = { name: "Post" };
  const sorted = (engine: Engine, existing: Index[], version = "8.4.3") => {
    const statement = readStatement(
      `SELECT "id" FROM "Post" WHERE "authorId" = ? ORDER BY "createdAt", "id" LIMIT 10`,
      engine,
    );
    return adviseSortIndex({
      engine,
      version,
      table: post,
      conditions: statement.query.conditions,
      orderBy: statement.query.orderBy,
      params: [1],
      existing,
    });
  };

  it("leaves out FULLTEXT, GIN and hash indexes, which find no rows by = nor give them in order", () => {
    const statement = readStatement("SELECT id FROM Post WHERE title = ?", "mysql");
    const input = {
      engine: "mysql" as const,
      table: post,
      conditions: statement.query.conditions,
      orderBy: [],
      params: ["a"],
    };
    expect(
      adviseIndex({ ...input, existing: [index(["title"], { method: "FULLTEXT" })] }),
    ).toBeDefined();
    expect(
      adviseIndex({ ...input, existing: [index(["title"], { method: "BTREE" })] }),
    ).toBeUndefined();
  });

  it("takes InnoDB's primary key at the end of every index into the order, and no prefix index", () => {
    const primary = index(["id"], { primary: true, unique: true });
    expect(sorted("mysql", [primary, index(["authorId", "createdAt"])])).toBeUndefined();
    expect(sorted("postgres", [primary, index(["authorId", "createdAt"])])).toBeDefined();
    expect(
      sorted("mysql", [primary, index(["authorId", "createdAt"], { prefix: { createdAt: 10 } })]),
    ).toBeDefined();
  });

  it("writes no DESC where it does nothing: before MySQL 8.0 and MariaDB 10.8", () => {
    const columns = [{ name: "createdAt", descending: true }];
    expect(writeAdvice("mysql", post, columns, "5.7.44").prisma).toBe("@@index([createdAt])");
    expect(writeAdvice("mariadb", post, columns, "10.6.20").prisma).toBe("@@index([createdAt])");
    expect(writeAdvice("mariadb", post, columns, "11.4.4").prisma).toBe(
      "@@index([createdAt(sort: Desc)])",
    );
  });
});
