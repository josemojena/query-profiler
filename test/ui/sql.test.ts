import { describe, expect, it } from "vitest";
import { formatSql, highlightSql } from "../../src/ui/sql.js";

const FIND_USER = `SELECT "public"."User"."id", "public"."User"."email" FROM "public"."User" WHERE ("public"."User"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3`;
const FIND_POSTS = `SELECT "public"."Post"."id", "public"."Post"."title", "public"."Post"."authorId", "public"."Post"."createdAt" FROM "public"."Post" WHERE ("public"."Post"."authorId" = $1 AND "public"."Post"."published" = $2 AND "public"."Post"."createdAt" BETWEEN $3 AND $4) ORDER BY "public"."Post"."id" ASC OFFSET $5`;
const COUNT_POSTS = `SELECT COUNT(*) AS "_count._all" FROM (SELECT "public"."Post"."id" FROM "public"."Post" WHERE "public"."Post"."authorId" = $1 OFFSET $2) AS "sub"`;
const CREATE_USER = `INSERT INTO "public"."User" ("email","name") VALUES ($1,$2) RETURNING "public"."User"."id", "public"."User"."email", "public"."User"."name", "public"."User"."createdAt"`;
const RAW = `select u.id, count(p.id) from users u left join posts p on p.author_id = u.id where u.deleted_at is null and u.email ilike '%@example.test' group by u.id order by count(p.id) desc limit 10`;
const UPSERT = `INSERT INTO "t" ("k") VALUES ($1) ON CONFLICT ("k") DO UPDATE SET "v" = excluded."v"`;

/** The SQL with its whitespace gone, except inside strings and quoted names. */
const solid = (sql: string) =>
  sql.replace(/('(?:[^']|'')*'|"(?:[^"]|"")*")|\s+/g, (_, quoted?: string) => quoted ?? "");

describe("formatted SQL", () => {
  it("puts each clause of a Prisma query on its own line, and keeps a short condition whole", () => {
    expect(formatSql(FIND_USER)).toBe(
      [
        `SELECT`,
        `  "public"."User"."id",`,
        `  "public"."User"."email"`,
        `FROM "public"."User"`,
        `WHERE ("public"."User"."id" = $1 AND 1=1)`,
        `LIMIT $2`,
        `OFFSET $3`,
      ].join("\n"),
    );
  });

  it("gives a long list one item per line, and a long condition one AND per line", () => {
    expect(formatSql(FIND_POSTS)).toBe(
      [
        `SELECT`,
        `  "public"."Post"."id",`,
        `  "public"."Post"."title",`,
        `  "public"."Post"."authorId",`,
        `  "public"."Post"."createdAt"`,
        `FROM "public"."Post"`,
        `WHERE (`,
        `  "public"."Post"."authorId" = $1`,
        `  AND "public"."Post"."published" = $2`,
        `  AND "public"."Post"."createdAt" BETWEEN $3 AND $4`,
        `)`,
        `ORDER BY "public"."Post"."id" ASC`,
        `OFFSET $5`,
      ].join("\n"),
    );
  });

  it("indents a subquery inside its parentheses", () => {
    expect(formatSql(COUNT_POSTS)).toBe(
      [
        `SELECT COUNT(*) AS "_count._all"`,
        `FROM (`,
        `  SELECT "public"."Post"."id"`,
        `  FROM "public"."Post"`,
        `  WHERE "public"."Post"."authorId" = $1`,
        `  OFFSET $2`,
        `) AS "sub"`,
      ].join("\n"),
    );
  });

  it("lays out writes, joins and lowercase SQL written by hand", () => {
    expect(formatSql(CREATE_USER).split("\n").slice(0, 3)).toEqual([
      `INSERT INTO "public"."User" ("email","name")`,
      `VALUES ($1,$2)`,
      `RETURNING`,
    ]);
    expect(formatSql(RAW)).toBe(
      [
        `select u.id, count(p.id)`,
        `from users u`,
        `left join posts p on p.author_id = u.id`,
        `where u.deleted_at is null`,
        `  and u.email ilike '%@example.test'`,
        `group by u.id`,
        `order by count(p.id) desc`,
        `limit 10`,
      ].join("\n"),
    );
    expect(formatSql(UPSERT)).toBe(
      [
        `INSERT INTO "t" ("k")`,
        `VALUES ($1)`,
        `ON CONFLICT ("k") DO UPDATE`,
        `SET "v" = excluded."v"`,
      ].join("\n"),
    );
  });

  it("does not split what only looks like a clause", () => {
    expect(formatSql(`SELECT 1 FROM "a" WHERE "x" IS NOT DISTINCT FROM $1`)).toBe(
      `SELECT 1\nFROM "a"\nWHERE "x" IS NOT DISTINCT FROM $1`,
    );
    expect(formatSql(`SELECT EXTRACT(YEAR FROM "at") FROM "a"`)).toBe(
      `SELECT EXTRACT(YEAR FROM "at")\nFROM "a"`,
    );
    expect(formatSql("BEGIN")).toBe("BEGIN");
  });

  it("changes nothing but whitespace, and never inside strings or quoted names", () => {
    const quoted = `SELECT 'two  spaces', "a  b" FROM "t" WHERE "c" = 'x  y'`;
    for (const sql of [FIND_USER, FIND_POSTS, COUNT_POSTS, CREATE_USER, RAW, UPSERT, quoted])
      expect(solid(formatSql(sql))).toBe(solid(sql));
    expect(formatSql(quoted)).toContain(`'two  spaces', "a  b"`);
  });

  it("leaves SQL with a line comment or a dollar-quoted body as written", () => {
    const commented = `SELECT a -- the id\n, b FROM t`;
    expect(formatSql(commented)).toBe(commented);
    const body = `CREATE FUNCTION f() RETURNS int AS $$ SELECT  1 $$ LANGUAGE sql`;
    expect(formatSql(body)).toBe(body);
  });
});

describe("MySQL and SQLite", () => {
  it("lay out like the rest, with backtick names kept whole", () => {
    expect(
      formatSql(
        "SELECT `User`.`id`, `User`.`email`, `User`.`password` FROM `User` WHERE `User`.`email` LIKE CONCAT('%', ?, '%') ORDER BY `User`.`id` ASC LIMIT ? OFFSET ?",
      ),
    ).toBe(
      [
        "SELECT",
        "  `User`.`id`,",
        "  `User`.`email`,",
        "  `User`.`password`",
        "FROM `User`",
        "WHERE `User`.`email` LIKE CONCAT('%', ?, '%')",
        "ORDER BY `User`.`id` ASC",
        "LIMIT ?",
        "OFFSET ?",
      ].join("\n"),
    );
    expect(formatSql("SELECT `a  b` FROM `t`")).toBe("SELECT `a  b`\nFROM `t`");
  });

  it("mark ? as a parameter", () => {
    expect(highlightSql("LIMIT ?")).toBe(
      `<span class="kw">LIMIT</span> <span class="param">?</span>`,
    );
  });
});

describe("highlighted SQL", () => {
  it("marks keywords, strings, parameters and comments, and escapes the rest", () => {
    expect(highlightSql(`SELECT "id" FROM "t" WHERE "x" = '<b>' AND "y" = $1 /* c */`)).toBe(
      `<span class="kw">SELECT</span> &quot;id&quot; <span class="kw">FROM</span> &quot;t&quot; ` +
        `<span class="kw">WHERE</span> &quot;x&quot; = <span class="str">&#39;&lt;b&gt;&#39;</span> ` +
        `<span class="kw">AND</span> &quot;y&quot; = <span class="param">$1</span> <span class="cm">/* c */</span>`,
    );
  });
});
